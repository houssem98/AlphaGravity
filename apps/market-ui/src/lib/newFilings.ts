// "New filings since last visit" — the detection half of filing alerts, done
// client-side with localStorage. No push/email delivery (that needs a backend
// notification channel the app doesn't have yet), but it surfaces "this ticker
// has a filing you haven't seen" the moment you open the page.

const KEY = (ticker: string) => `company_lastseen_${ticker.toUpperCase()}`;

// The newest filing_date the user saw last time they viewed this ticker.
export function lastSeen(ticker: string): string | null {
    try { return localStorage.getItem(KEY(ticker)); } catch { return null; }
}

export function markSeen(ticker: string, newestFilingDate: string | null): void {
    if (!newestFilingDate) return;
    try { localStorage.setItem(KEY(ticker), newestFilingDate); } catch { /* ignore */ }
}

// Pure: given filing dates and the last-seen watermark, which are new? First
// visit (no watermark) returns none — don't flag a whole history as "new".
export function isNewFiling(filingDate: string | null, watermark: string | null): boolean {
    if (!filingDate || !watermark) return false;
    return filingDate > watermark;   // ISO YYYY-MM-DD compares lexically
}

export function newCount(filingDates: (string | null)[], watermark: string | null): number {
    return filingDates.filter(d => isNewFiling(d, watermark)).length;
}
