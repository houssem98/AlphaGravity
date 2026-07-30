// G2.5a — Gamma's "themes": global design tokens swappable without touching
// content. The theme is an enum on the DesignSpec, so the designer chooses a
// look the same bounded way it chooses an accent — it can never emit CSS.
//
// Tokens are the values that actually define a look. Anything a theme does
// not name stays on the house default rather than being invented per theme.

export const REPORT_THEMES = ['institutional', 'editorial', 'mono'] as const;
export type ReportTheme = typeof REPORT_THEMES[number];

export function isReportTheme(v: unknown): v is ReportTheme {
    return typeof v === 'string' && (REPORT_THEMES as readonly string[]).includes(v);
}

export interface ThemeTokens {
    /** Web font stack. */
    fontFamily: string;
    /** @react-pdf/renderer ships Helvetica, Times-Roman and Courier only. */
    pdfFontFamily: 'Helvetica' | 'Times-Roman' | 'Courier';
    ink: string;
    inkMuted: string;
    inkFaint: string;
    surface: string;
    surfaceLift: string;
    rule: string;
    /** Fallback accent. An explicit DesignSpec.accent (tone-driven) wins. */
    accent: string;
    radius: number;
    rowGap: number;
}

const THEMES: Record<ReportTheme, ThemeTokens> = {
    // The house look the reports already ship with.
    institutional: {
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        pdfFontFamily: 'Helvetica',
        ink: '#E8EDF5', inkMuted: '#A0AABF', inkFaint: '#5A6480',
        surface: 'rgba(255,255,255,0.02)', surfaceLift: 'rgba(255,255,255,0.04)',
        rule: 'rgba(255,255,255,0.07)',
        accent: '#3D7FF6', radius: 12, rowGap: 26,
    },
    // Longer-form, serif, more air between rows.
    editorial: {
        fontFamily: 'Georgia, "Iowan Old Style", Times, serif',
        pdfFontFamily: 'Times-Roman',
        ink: '#F0EAE0', inkMuted: '#B5AA9A', inkFaint: '#6B6153',
        surface: 'rgba(255,247,235,0.03)', surfaceLift: 'rgba(255,247,235,0.06)',
        rule: 'rgba(255,247,235,0.10)',
        accent: '#C2703D', radius: 4, rowGap: 30,
    },
    // Data-first: monospace, near-monochrome, tight.
    mono: {
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        pdfFontFamily: 'Courier',
        ink: '#DDE3EA', inkMuted: '#93A0AD', inkFaint: '#5A646E',
        surface: 'rgba(255,255,255,0.025)', surfaceLift: 'rgba(255,255,255,0.05)',
        rule: 'rgba(255,255,255,0.09)',
        accent: '#8FA3B8', radius: 2, rowGap: 22,
    },
};

export const DEFAULT_THEME: ReportTheme = 'institutional';

// Returns a copy: handing out the shared object lets one surface's tweak
// leak into every other surface using that theme.
export function themeTokens(theme?: unknown): ThemeTokens {
    return { ...THEMES[isReportTheme(theme) ? theme : DEFAULT_THEME] };
}
