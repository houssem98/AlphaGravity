Execute BOTH roadmap and execution instructions in the current AlphaGravity repository.

STEP 1
Read:
`QUICK_ANSWER_RUTHLESS_FIX_ROADMAP.md`

STEP 2
Read:
`CLAUDE_CODE_QUICK_ANSWER_RUTHLESS_EXECUTION_PROMPT.md`

STEP 3
Treat the roadmap as the specification and the execution prompt as the operating instructions.

STEP 4
Inspect the actual code before making changes.

STEP 5
Implement the fixes directly.

STEP 6
Add tests for every behavior changed.

STEP 7
Run the tests and fix every failure.

STEP 8
Run the complete validation suite again.

STEP 9
Do not weaken/delete tests and do not fake blocked live/browser tests.

STEP 10
Do not stop after writing a report. Continue coding until every executable gate is PASS.

CRITICAL ACCEPTANCE

- `View filing` MUST open the exact primary SEC HTML.
- `Filing details` MUST open the SEC `-index.htm` filing-detail page.
- Frontend MUST NOT guess SEC filing URLs.
- Company MUST work for arbitrary resolvable companies, not a small allowlist.
- Sentiment MUST work for arbitrary resolvable companies with evidence and time-window handling.
- Ambiguous companies MUST NOT be guessed.
- Missing data MUST remain missing.
- Future/unreported periods MUST deterministically abstain.
- Invalid/wrong citations MUST NEVER receive a verified state.
- SEC provenance verdict MUST NOT be overwritten.
- Provider failures MUST NOT masquerade as empty successful retrieval.
- Multi-company and multi-period cases must be tested where applicable.
- Previous Quick Answer regressions must remain fixed.
- Performance must be measured honestly.

Required documentation:

`docs/quick-answer/SKILL_COVERAGE_MATRIX.md`
`docs/quick-answer/FINAL_FIX_VERIFICATION.md`

FINAL CLAUDE CODE REPORT MUST INCLUDE

1. Files changed
2. Tests added
3. Backend test count
4. Frontend test count
5. Typecheck result
6. Build result
7. Quick Answer evaluation result
8. Skill coverage result
9. SEC resolver/direct-document result
10. Entity-resolution result
11. Verification result
12. Future-period result
13. Channel-failure result
14. Live E2E result
15. Browser result
16. Performance p50/p95
17. Git status
18. Every remaining PARTIAL/BLOCKED/UNVERIFIED gate

Do not claim `world-class`, `complete`, or `production-ready` unless the evidence supports it.

START NOW.
