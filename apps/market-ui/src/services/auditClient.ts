// auditClient — record external exports/dissemination for compliance.
// SEC 17a-4 / FINRA 4511: exporting or sharing an AI-generated record is itself
// a recordable event. Best-effort + non-blocking — never breaks the export.

import { getAccessToken } from './supabase';

const GRAVITY_API = import.meta.env?.VITE_GRAVITY_API_URL || 'http://localhost:8000';

export async function recordExport(
    format: 'csv' | 'xlsx' | 'pdf' | 'memo' | 'share_link' | 'email',
    opts: { bytes?: number; destination?: string; eventId?: string } = {},
): Promise<void> {
    try {
        const tok = await getAccessToken();
        const params = new URLSearchParams({
            format,
            event_id: opts.eventId ?? 'adhoc',
            destination: opts.destination ?? '',
            bytes_size: String(opts.bytes ?? 0),
        });
        await fetch(`${GRAVITY_API}/v1/audit/export?${params.toString()}`, {
            method: 'POST',
            headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        });
    } catch {
        // best-effort — audit must never block or fail an export
    }
}
