import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// MF-1 · row R5 of docs/MOBILE_FIELD_ROADMAP.md, for the one fault no headless
// run can reach.
//
// G3 — the PDF preview modal has no reachable close control — is photographed
// in attachments/Screenshot_20260805-122241.png. It cannot be reproduced in
// e2e/mobileField.spec.ts because PdfPreview mounts only from
// ResearchReport.tsx, which needs a completed deep-research report carrying a
// PDF source; on prod that is a multi-minute LLM run and DEEPSEEK_API_KEY is
// the only live provider. So the gate is on the mechanism instead of the pixel.
//
// The mechanism is exact and is visible in the source: the toolbar is
// `flex items-center justify-between` over two groups. The left group holds
// three dots, an icon, `PDF Preview`, and a `truncate max-w-[320px]` title —
// 320px of title alone on a 360px screen. Neither group declares how it
// behaves when the row runs out of width, so flexbox shrinks whichever it can
// and the right group — zoom, download, and **close** — is pushed past the
// frame. `truncate` cannot help a flex child that has no `min-w-0`: the child's
// automatic minimum size is its content, so it refuses to shrink at all.
//
// The fix is two classes. This gate names them, and fails until they land.
const SRC = readFileSync(new URL('./components/research/PdfPreview.tsx', import.meta.url), 'utf8');

// MP-6 · the window was 2600 chars and the close button sits 4510 chars past
// the marker, so the `aria-label` assertion below was reading source that ends
// before the control it grades — it could not have passed whatever the code
// did. Widened to the whole toolbar block, which is where the toolbar ends
// (`── Preview area ──`). The gate now sees more source, not less.
const toolbar = SRC.slice(SRC.indexOf('── Toolbar ──'), SRC.indexOf('── Preview area ──'));
const leftGroup = toolbar.slice(toolbar.indexOf('Left: traffic lights'), toolbar.indexOf('Right: zoom'));
const rightGroup = toolbar.slice(toolbar.indexOf('Right: zoom'));

describe('G3 — the PDF preview must keep its close button on screen', () => {
    it('mounts only from ResearchReport, which is why this gate is a source gate', () => {
        const report = readFileSync(new URL('./components/research/ResearchReport.tsx', import.meta.url), 'utf8');
        expect(report).toContain('PdfPreview');
    });

    it('the left group can shrink — it declares min-w-0', () => {
        expect(leftGroup).toMatch(/min-w-0/);
    });

    it('the right group cannot be pushed out — it declares shrink-0', () => {
        expect(rightGroup).toMatch(/shrink-0/);
    });

    it('the close control exists and is labelled for a screen reader', () => {
        expect(rightGroup).toMatch(/aria-label=["']Close/);
    });
});
