// gridShare — self-contained shareable grid links.
// Encodes a GridState into a URL fragment so anyone can open a shared grid
// without auth or a server round-trip. Server-backed sharing needs an is_public
// column + RLS policy on grid_runs (Supabase DDL, manual) — this needs neither.

import type { GridState } from './gridResearch';

const HASH_KEY = 'gridshare';
// Browsers handle large fragments, but a multi-MB URL is unwieldy. Above this,
// tell the user to use Excel export instead.
const MAX_ENCODED_BYTES = 64_000;

// UTF-8-safe base64 (btoa only handles latin1).
function b64encode(s: string): string {
    return btoa(unescape(encodeURIComponent(s)));
}
function b64decode(s: string): string {
    return decodeURIComponent(escape(atob(s)));
}

/** Encode grid state for a share link, or null if too large to embed. */
export function encodeGridState(state: GridState): string | null {
    const encoded = b64encode(JSON.stringify(state));
    if (encoded.length > MAX_ENCODED_BYTES) return null;
    return encoded;
}

export function buildShareLink(state: GridState): string | null {
    const encoded = encodeGridState(state);
    if (!encoded) return null;
    return `${window.location.origin}${window.location.pathname}#${HASH_KEY}=${encoded}`;
}

/** Read + decode a shared grid from the current URL fragment, if present. */
export function readSharedGridFromUrl(): GridState | null {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const enc = params.get(HASH_KEY);
    if (!enc) return null;
    try {
        const state = JSON.parse(b64decode(enc)) as GridState;
        if (state && state.def && state.cells) return state;
    } catch {
        // malformed link — ignore
    }
    return null;
}

export function clearSharedGridFromUrl(): void {
    if (window.location.hash.includes(HASH_KEY)) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
}
