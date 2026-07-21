import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTnIndex, fmtPrice, fmtPct } from './marketsHub';

afterEach(() => vi.unstubAllGlobals());

// Before the BVMT session opens, /api/tn/index returns the object with null
// level — leading the hub with it put price: null into fmtPrice and blanked
// the whole /trading route.
describe('fetchTnIndex', () => {
  const stub = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));

  it('returns null when the session has not opened', async () => {
    stub({ tunindex: { name: 'TUNINDEX', level: null, changePct: null, prevClose: 21253.75 } });
    expect(await fetchTnIndex()).toBeNull();
  });

  it('returns the level when live', async () => {
    stub({ tunindex: { level: 21300.5, changePct: 0.22 } });
    expect(await fetchTnIndex()).toEqual({ level: 21300.5, changePct: 0.22 });
  });
});

describe('formatters', () => {
  it('render a dash instead of throwing on a missing quote', () => {
    expect(fmtPrice(null, 'TND')).toBe('—');
    expect(fmtPrice(undefined, 'USD')).toBe('—');
    expect(fmtPrice(NaN, 'RATE')).toBe('—');
    expect(fmtPct(null)).toBe('—');
  });

  it('still formats real numbers', () => {
    expect(fmtPrice(182, 'TND')).toBe('182.00 TND');
    expect(fmtPct(-1.5)).toBe('-1.50%');
  });
});
