// Structural PDF QA (REPORT_QA_SPEC P0-7 acceptance — "no table row spans a
// page break", the check deferred at QA-4 as visual-only). Reads the RENDERED
// PDF's structure via opendataloader-pdf (Java CLI → JSON with per-element
// page numbers + bounding boxes) and audits what only geometry can prove:
// a table row whose cells land on two different pages, and skipped heading
// levels (h1→h3). The auditor itself is pure over the JSON tree — Java-free,
// unit-tested with fixtures; extraction is an optional wrapper that lights up
// when Java 11+ is installed (opendataloader shells out to a bundled JAR).
//
// Harness/CI only: opendataloader needs a file path + a JRE, so it can't run
// in the browser export. It runs where the e2e harness writes the PDF to disk.

// ─── JSON node shape (opendataloader-pdf `--format json`) ───────────────────
// Elements carry: type, "page number", "bounding box" [l,b,r,t]; headings a
// string "level"; tables nest rows → cells, each cell with its own page.

export interface OdlNode {
    type?: string;
    level?: string;
    content?: string;
    'page number'?: number;
    'bounding box'?: number[];
    'row number'?: number;
    rows?: OdlNode[];
    cells?: OdlNode[];
    kids?: OdlNode[];
    children?: OdlNode[];
    [k: string]: unknown;
}

export interface SplitRow {
    rowNumber: number | null;
    pages: number[];        // the distinct pages this row's cells landed on
}

export interface HeadingSkip {
    from: number;
    to: number;
    heading: string;
}

export interface StructuralQaResult {
    ok: boolean;
    tables: number;
    headings: number;
    splitRows: SplitRow[];      // a row straddling a page break (regression test 7)
    headingSkips: HeadingSkip[];
}

function childrenOf(n: OdlNode): OdlNode[] {
    return [
        ...(n.kids ?? []),
        ...(n.rows ?? []),
        ...(n.cells ?? []),
        ...(n.children ?? []),
    ];
}

// Depth-first walk yielding every node (root may be an array or a single obj).
function* walk(root: OdlNode | OdlNode[]): Generator<OdlNode> {
    const stack: OdlNode[] = Array.isArray(root) ? [...root] : [root];
    while (stack.length) {
        const n = stack.pop()!;
        if (!n || typeof n !== 'object') continue;
        yield n;
        stack.push(...childrenOf(n));
    }
}

// Every page number appearing anywhere in a subtree (cells carry their own).
function pagesInSubtree(node: OdlNode): number[] {
    const pages = new Set<number>();
    for (const n of walk(node)) {
        const p = n['page number'];
        if (typeof p === 'number') pages.add(p);
    }
    return [...pages].sort((a, b) => a - b);
}

export function auditStructure(root: OdlNode | OdlNode[]): StructuralQaResult {
    const splitRows: SplitRow[] = [];
    const headingSkips: HeadingSkip[] = [];
    let tables = 0;
    let headings = 0;

    // Headings in document order — collected via an in-order recursion so a
    // level skip is judged against the PREVIOUS heading, not tree adjacency.
    const headingLevels: Array<{ level: number; text: string }> = [];
    const collectHeadings = (n: OdlNode) => {
        if (n.type === 'heading') {
            const lvl = parseInt(n.level ?? '', 10);
            if (Number.isFinite(lvl)) headingLevels.push({ level: lvl, text: n.content ?? '' });
        }
        for (const c of childrenOf(n)) collectHeadings(c);
    };
    for (const top of (Array.isArray(root) ? root : [root])) collectHeadings(top);

    for (const n of walk(root)) {
        if (n.type === 'heading') headings += 1;
        // A table is any node carrying rows; each row's cells must share a page.
        if (Array.isArray(n.rows) && n.rows.length > 0) {
            tables += 1;
            for (const row of n.rows) {
                const pages = pagesInSubtree(row);
                if (pages.length > 1) {
                    splitRows.push({ rowNumber: (row['row number'] as number) ?? null, pages });
                }
            }
        }
    }

    for (let i = 1; i < headingLevels.length; i++) {
        const prev = headingLevels[i - 1].level;
        const cur = headingLevels[i].level;
        if (cur - prev > 1) {
            headingSkips.push({ from: prev, to: cur, heading: headingLevels[i].text.slice(0, 60) });
        }
    }

    return {
        ok: splitRows.length === 0 && headingSkips.length === 0,
        tables, headings, splitRows, headingSkips,
    };
}

// ─── Optional extraction wrapper (needs Java 11+) ───────────────────────────

let _javaChecked: boolean | null = null;

export async function isJavaAvailable(): Promise<boolean> {
    if (_javaChecked !== null) return _javaChecked;
    try {
        const { execFileSync } = await import('node:child_process');
        execFileSync('java', ['-version'], { stdio: 'ignore' });
        _javaChecked = true;
    } catch {
        _javaChecked = false;
    }
    return _javaChecked;
}

// Extract structure from a PDF on disk. Returns null (never throws) when Java
// or the package is unavailable, so callers can treat structural QA as an
// enhancement that either runs or is cleanly skipped.
export async function extractStructure(pdfPath: string): Promise<OdlNode | OdlNode[] | null> {
    if (!(await isJavaAvailable())) return null;
    try {
        const odl = await import('@opendataloader/pdf');
        const json = await odl.convert(pdfPath, { format: 'json', toStdout: true, quiet: true } as any);
        return JSON.parse(json);
    } catch {
        return null;
    }
}

export async function structuralQa(pdfPath: string): Promise<StructuralQaResult | null> {
    const tree = await extractStructure(pdfPath);
    return tree ? auditStructure(tree) : null;
}
