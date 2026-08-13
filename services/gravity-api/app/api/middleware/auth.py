"""
Gravity Search — API Key + JWT Authentication
FastAPI dependency (not HTTP middleware) so individual routes can opt in/out.

In DEVELOPMENT mode: all requests bypass auth (returns dev_user context).
In PRODUCTION mode: validates X-API-Key header against Redis-stored keys.
"""

import structlog
from fastapi import Header, HTTPException, Request
from typing import Optional

from app.billing.tiers import DEFAULT_TIER
from app.config import settings, Environment

logger = structlog.get_logger()


async def require_auth(
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    FastAPI dependency for authentication.

    Development: bypass auth, return dev_user context.
    Production: validate X-API-Key or Bearer JWT.

    Usage:
        @router.post("/search")
        async def search(auth: dict = Depends(require_auth)):
            user_id = auth["user_id"]
    """
    # Development bypass. Only reachable when APP_ENV is explicitly "development";
    # the settings default is PRODUCTION so an unset env fails closed.
    if settings.app_env == Environment.DEVELOPMENT:
        logger.warning("auth_bypassed_development_mode", path=request.url.path)
        return {
            "user_id": "dev_user",
            "tier": "unlimited",
            "api_key": "dev",
        }

    # Production: validate API key
    if x_api_key:
        user = await _validate_api_key(x_api_key)
        if user:
            return user
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Production: validate Bearer JWT
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        user = await _validate_jwt(token)
        if user:
            return await _apply_entitlement(request, user)
        raise HTTPException(status_code=401, detail="Invalid token")

    raise HTTPException(
        status_code=401,
        detail="Authentication required. Provide X-API-Key header or Bearer token.",
    )


# Internal service keys (the market-ui RAG proxy + eval harness). These already
# ship in the frontend bundle, so they're not secrets — recognising them WITHOUT a
# Redis lookup keeps the Research Grid / Deep Research working even when the Upstash
# quota is exhausted (writes blocked, lookups unreliable). Extra keys via env
# INTERNAL_API_KEYS (comma-separated).
async def _apply_entitlement(request: Request, user: dict) -> dict:
    """
    Replace the tier a token *claims* with the tier the subscription actually grants.

    A JWT is proof of identity, not of payment. The Supabase branch of `_to_auth_dict`
    has no plan information to report — Supabase does not know what a user bought —
    so it fills in the free tier as a placeholder, and before this function existed
    that placeholder was the final answer for every production request
    (docs/PLANS_WORLD_CLASS_ROADMAP.md §1c). The subscription table is the authority;
    this is where it gets asked.

    API keys deliberately do not come through here. Service keys and the dev bypass
    carry `unlimited`, they are not subscribers, and there is no row to look up.
    """
    from app.billing.entitlements import entitlements_for

    pool = getattr(request.app.state, "pg_pool", None)
    tier = await entitlements_for(pool, user.get("user_id", ""))
    claimed = user.get("tier")
    user["tier"] = tier.id
    if claimed != tier.id:
        logger.debug("tier_resolved_from_subscription",
                     user_id=user.get("user_id"), claimed=claimed, served=tier.id)
    return user


def _internal_keys() -> set[str]:
    import os
    base = {"deep-research-internal", "eval-unlimited-fb-2026"}
    extra = os.getenv("INTERNAL_API_KEYS", "")
    return base | {k.strip() for k in extra.split(",") if k.strip()}


async def _validate_api_key(api_key: str) -> dict | None:
    """Validate API key: static internal allowlist first (Redis-independent), then Redis."""
    if api_key in _internal_keys():
        return {
            "user_id": f"svc:{api_key[:16]}",
            "tier": "unlimited",
            "api_key": api_key,
            "entitlements": ["public"],
        }
    try:
        from app.db.redis import redis_client
        import json
        user_json = await redis_client.get(f"apikey:{api_key}")
        if user_json:
            return json.loads(user_json)
        return None
    except Exception as e:
        logger.warning("api_key_validation_error", error=str(e))
        return None


_JWKS_CACHE: dict = {"keys": None, "fetched_at": 0.0}


async def _supabase_jwks() -> dict | None:
    """Fetch + cache Supabase JWKS (24h)."""
    import os, time
    sb_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not sb_url:
        return None
    if _JWKS_CACHE["keys"] and (time.time() - _JWKS_CACHE["fetched_at"]) < 86400:
        return _JWKS_CACHE["keys"]
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{sb_url}/auth/v1/.well-known/jwks.json")
            if r.status_code != 200:
                return None
            data = r.json()
        _JWKS_CACHE["keys"] = data
        _JWKS_CACHE["fetched_at"] = time.time()
        return data
    except Exception as e:
        logger.warning("supabase_jwks_fetch_failed", error=str(e))
        return None


async def _validate_jwt(token: str) -> dict | None:
    """
    Validate JWT Bearer token. Tries three issuers in order:
      1. Supabase ES256 (current — asymmetric, JWKS-verified)
      2. Supabase HS256 (legacy projects, SUPABASE_JWT_SECRET)
      3. AuthStore.issue_access_token (AUTH_JWT_SECRET) — gravity-api own JWTs
    """
    import os
    from jose import jwt

    def _to_auth_dict(payload: dict, *, supabase: bool) -> dict:
        if supabase:
            return {
                "user_id": payload.get("sub", "unknown"),
                "email": payload.get("email", ""),
                "org_id": "",
                "role": payload.get("role", "authenticated"),
                "entitlements": ["public"],
                # Placeholder only. A Supabase token carries no plan information,
                # so this is what the token CLAIMS; `_apply_entitlement` replaces it
                # with what the subscription grants before the request is served.
                # Until PL-4 that replacement did not happen and this literal was
                # the final answer for every production request. §1c.
                "tier": DEFAULT_TIER,
            }
        return {
            "user_id": payload.get("sub", "unknown"),
            "email": payload.get("email", ""),
            "org_id": payload.get("org_id", ""),
            "role": payload.get("role", "member"),
            "entitlements": payload.get("entitlements", []),
            "tier": payload.get("tier", "free"),
        }

    # 1. Supabase ES256 via JWKS (current default).
    try:
        unverified_header = jwt.get_unverified_header(token)
        alg = unverified_header.get("alg", "")
        kid = unverified_header.get("kid", "")
        if alg in ("ES256", "RS256"):
            jwks = await _supabase_jwks()
            if jwks and jwks.get("keys"):
                key = next((k for k in jwks["keys"] if k.get("kid") == kid), None) or jwks["keys"][0]
                payload = jwt.decode(
                    token, key, algorithms=[alg],
                    audience="authenticated",
                )
                return _to_auth_dict(payload, supabase=True)
    except Exception:
        pass

    # 2. Supabase HS256 (legacy projects).
    sb_secret = os.getenv("SUPABASE_JWT_SECRET", "")
    if sb_secret:
        try:
            payload = jwt.decode(
                token, sb_secret, algorithms=["HS256"],
                audience="authenticated",
            )
            return _to_auth_dict(payload, supabase=True)
        except Exception:
            pass

    # 3. Legacy gravity-api JWTs.
    own_secret = os.getenv("AUTH_JWT_SECRET", "")
    if own_secret:
        try:
            payload = jwt.decode(token, own_secret, algorithms=["HS256"])
            if payload.get("type") != "access":
                return None
            return _to_auth_dict(payload, supabase=False)
        except Exception:
            pass

    return None
