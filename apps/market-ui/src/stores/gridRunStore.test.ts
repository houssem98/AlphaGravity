import { describe, it, expect, beforeEach } from 'vitest';
import { useGridRunStore } from './gridRunStore';
import type { GridState } from '../services/gridResearch';

const mkState = (name: string): GridState => ({
    def: { id: 'g1', name, tickers: ['NVDA'], prompts: [] },
    cells: {},
});

describe('gridRunStore', () => {
    beforeEach(() => {
        useGridRunStore.setState({ gridState: null, running: false, runStats: null, changedCells: new Set() });
    });

    it('accepts both value and updater forms (GridView uses both)', () => {
        const { setGridState } = useGridRunStore.getState();

        setGridState(mkState('first'));
        expect(useGridRunStore.getState().gridState?.def.name).toBe('first');

        setGridState(s => (s ? { ...s, def: { ...s.def, name: 'updated' } } : s));
        expect(useGridRunStore.getState().gridState?.def.name).toBe('updated');
    });

    it('accumulates changed cells via the updater form', () => {
        const { setChangedCells } = useGridRunStore.getState();
        setChangedCells(prev => new Set(prev).add('NVDA::thesis'));
        setChangedCells(prev => new Set(prev).add('NVDA::moat'));
        expect([...useGridRunStore.getState().changedCells].sort()).toEqual(['NVDA::moat', 'NVDA::thesis']);
    });

    it('AC-5: cellSteps set + clear per cell key', () => {
        const { setCellStep } = useGridRunStore.getState();
        setCellStep('NVDA::thesis', 'Searching SEC filings');
        setCellStep('NVDA::moat', 'Fetching market data');
        expect(useGridRunStore.getState().cellSteps['NVDA::thesis']).toBe('Searching SEC filings');
        setCellStep('NVDA::thesis', null);
        expect(useGridRunStore.getState().cellSteps['NVDA::thesis']).toBeUndefined();
        expect(useGridRunStore.getState().cellSteps['NVDA::moat']).toBe('Fetching market data');
    });

    it('survives a simulated unmount — state is module-scoped, not component-scoped', () => {
        useGridRunStore.getState().setGridState(mkState('in-flight'));
        useGridRunStore.getState().setRunning(true);
        // GridView unmounting does not touch the store; a remount reads this back.
        expect(useGridRunStore.getState().running).toBe(true);
        expect(useGridRunStore.getState().gridState?.def.name).toBe('in-flight');
    });
});
