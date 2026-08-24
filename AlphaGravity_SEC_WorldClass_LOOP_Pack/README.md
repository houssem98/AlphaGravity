# AlphaGravity World-Class SEC Upgrade — Files

This package contains the implementation control documents for the SEC reliability upgrade.

## Files

- `FIX_SECFILING.md` — complete technical roadmap and acceptance criteria.
- `LOOP_GRAPH_NOTE.md` — LOOP graph, gates, dependencies, invariants and execution model.
- `LOOP_PROMPT_FIX_SECFILING.md` — Claude Code execution prompt.

## Intended execution

1. Put the three files into the AlphaGravity repository.
2. Put them where your existing LOOP conventions expect project roadmaps/prompts.
3. Start Claude Code with `LOOP_PROMPT_FIX_SECFILING.md`.
4. Claude must inspect the repository's actual LOOP files first.
5. The SEC path is query-time acquisition + asynchronous persistence, not continuous filing polling.
6. The NVIDIA Q3 FY2026 empty-corpus regression is the primary proof that the fix works.

## Important

The public main branch currently exposes the AlphaGravity application/SEC architecture, but the previously discussed local LOOP files are not visible at the repository root. The execution prompt therefore requires Claude to inspect the actual local LOOP implementation before modifying it.

Do not call the project world-class based on architecture alone. The roadmap requires measured source-resolution, numeric, citation, adversarial and empty-corpus results.
