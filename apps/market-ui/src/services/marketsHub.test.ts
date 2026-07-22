import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTnIndex, fetchMarket, fmtPrice, fmtPct } from './marketsHub';

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

// TNC-7: a stock that did not trade has volume 0 and turnover 0 — real answers.
// `|| undefined` erased them, so the cell could not tell them from a failed load.
describe('fetchTunisia — did not trade vs unknown', () => {
  it('keeps a real 0 for volume and turnover, and drops the range', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        board: [
          { symbol: 'AB', name: 'AB', price: 96.4, changePct: 0.2, volume: 13142, turnover: 1e6, high: 97, low: 96.4 },
          { symbol: 'AST', name: 'ASTREE', price: 75.5, changePct: 0, volume: 0, turnover: 0, high: null, low: null },
        ],
      }),
    }));

    const rows = await fetchMarket({ id: 'tn', source: 'tunisia', symbols: [] } as any);
    const ast = rows.find((r) => r.symbol === 'AST')!;
    const ab = rows.find((r) => r.symbol === 'AB')!;

    expect(ast.volume).toBe(0);
    expect(ast.turnover).toBe(0);
    expect(ast.dayHigh).toBeUndefined();
    expect(ast.dayLow).toBeUndefined();
    expect(ab.volume).toBe(13142);
    expect(ab.dayHigh).toBe(97);
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
