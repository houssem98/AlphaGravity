"""CF-10 gate. Every surface the company page reads must sit under ONE router
behind ONE auth dependency.

Inspects the real FastAPI router — its routes and their resolved dependencies —
rather than grepping the file, so a route that merely mentions require_auth in a
comment cannot pass. Then calls the two Supabase-backed handlers for real, to
show that unifying the router did not break them.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf10-gate.py
"""
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API = ROOT / "services" / "gravity-api"
sys.path.insert(0, str(API))

for env_file in (API / ".env", ROOT / ".env"):
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

from app.api.middleware.auth import require_auth  # noqa: E402
from app.api.routes import company as company_routes  # noqa: E402

AUTH = {"user_id": "gate", "tier": "unlimited", "api_key": "gate"}

# The four surfaces the company page reads.
REQUIRED = {
    "/company/{ticker}/filings",
    "/company/{ticker}/financials",
    "/company/{ticker}/trend",
    "/company/{ticker}/sentiment",
}

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


def main() -> int:
    routes = {r.path: r for r in company_routes.router.routes}

    check("all four company surfaces live on one router",
          REQUIRED <= set(routes),
          f"missing: {sorted(REQUIRED - set(routes))}")

    # The dependency has to be the real callable, resolved by FastAPI — not a
    # string match on the source.
    for path in sorted(REQUIRED & set(routes)):
        deps = [d.call for d in routes[path].dependant.dependencies]
        check(f"{path} depends on require_auth", require_auth in deps,
              f"resolved dependencies: {[getattr(d, '__name__', d) for d in deps]}")

    # One dependency, not four different ones.
    auth_deps = {
        d.call
        for path in REQUIRED & set(routes)
        for d in routes[path].dependant.dependencies
    }
    check("the router uses exactly one auth dependency", len(auth_deps) == 1,
          f"found {len(auth_deps)}: {[getattr(d, '__name__', d) for d in auth_deps]}")

    # Unifying the router must not have broken the handlers that worked.
    async def live():
        f = await company_routes.company_filings("TSLA", limit=20, auth=AUTH)
        n = await company_routes.company_financials("NVDA", limit=80, auth=AUTH)
        return f, n

    filings, fins = asyncio.run(live())
    check("filings still returns the true count after the move",
          filings["total"] == 9, f"TSLA total={filings['total']}, expected 9")
    check("financials still returns the requested page",
          len(fins["rows"]) == 80, f"NVDA rows={len(fins['rows'])}")

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
