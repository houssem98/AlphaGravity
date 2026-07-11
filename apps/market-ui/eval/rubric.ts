// Moved to src/services/evalRubric.ts so app code (selfImprovementHarness,
// pdfDesigner) can import it inside the tsconfig.app project boundary.
// This shim keeps existing eval/ imports working.
export * from '../src/services/evalRubric';
