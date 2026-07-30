// G2.5a — theme tokens. The point of a theme is that it is swappable and
// total: every theme must define every token, or a surface silently falls
// back to another theme's look.

import { describe, it, expect } from 'vitest';
import {
    REPORT_THEMES, themeTokens, isReportTheme, DEFAULT_THEME, type ThemeTokens,
} from './reportTheme';

const TOKEN_KEYS: (keyof ThemeTokens)[] = [
    'fontFamily', 'pdfFontFamily', 'ink', 'inkMuted', 'inkFaint',
    'surface', 'surfaceLift', 'rule', 'accent', 'radius', 'rowGap',
];

describe('reportTheme', () => {
    it('offers exactly the three built-in themes', () => {
        expect([...REPORT_THEMES]).toEqual(['institutional', 'editorial', 'mono']);
    });

    it('defines every token in every theme', () => {
        for (const t of REPORT_THEMES) {
            const tokens = themeTokens(t);
            for (const k of TOKEN_KEYS) {
                expect(tokens[k], `${t}.${k}`).toBeDefined();
                expect(tokens[k], `${t}.${k}`).not.toBe('');
            }
        }
    });

    it('falls back to the house theme for anything unknown', () => {
        const house = themeTokens(DEFAULT_THEME);
        expect(themeTokens('hyperpop')).toEqual(house);
        expect(themeTokens(undefined)).toEqual(house);
        expect(themeTokens(null)).toEqual(house);
        expect(themeTokens({ theme: 'mono' })).toEqual(house);
    });

    it('only accepts the enum', () => {
        expect(isReportTheme('mono')).toBe(true);
        expect(isReportTheme('Mono')).toBe(false);
        expect(isReportTheme('')).toBe(false);
    });

    it('keeps the PDF font to the three faces react-pdf actually ships', () => {
        for (const t of REPORT_THEMES) {
            expect(['Helvetica', 'Times-Roman', 'Courier']).toContain(themeTokens(t).pdfFontFamily);
        }
    });

    it('gives each theme a distinguishable look', () => {
        const fonts = REPORT_THEMES.map(t => themeTokens(t).pdfFontFamily);
        expect(new Set(fonts).size).toBe(REPORT_THEMES.length);
        const accents = REPORT_THEMES.map(t => themeTokens(t).accent);
        expect(new Set(accents).size).toBe(REPORT_THEMES.length);
    });

    it('does not let callers mutate a theme for everyone else', () => {
        themeTokens('mono').accent = '#000000';
        expect(themeTokens('mono').accent).not.toBe('#000000');
    });
});
