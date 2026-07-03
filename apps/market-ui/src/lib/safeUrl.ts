// Guard against javascript:/data:/vbscript: URIs reaching an <a href>.
// React does NOT strip dangerous schemes from href in plain JSX (only a
// dev-mode warning), so any URL sourced from web/social/scraped/token data
// must pass through here before it hits an anchor. Returns undefined for
// anything that isn't a plain http(s)/mailto link so the href is dropped.
export function safeUrl(u?: string | null): string | undefined {
    if (!u) return undefined;
    try {
        const p = new URL(u, window.location.origin);
        return ['http:', 'https:', 'mailto:'].includes(p.protocol) ? u : undefined;
    } catch {
        return undefined;
    }
}
