# Quick Answer — Baseline

Recorded before any roadmap change. Facts only: every number below came from a
command run in this repository on the date shown.

Date: 2026-08-27
Branch: `feat/web-research-sec-integration`
Commit at baseline: `3265969`

## Commands and results

| Command | Exit | Result |
|---|---|---|
| `python -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval` (services/gravity-api) | 0 | **1146 passed**, 0 failed, 26 warnings, 459.76s |
| `npx vitest run src/` (apps/market-ui) | 0 | **1355 passed**, 0 failed |
| `python -m pytest tests/ --co` | 0 | 1146 tests collected in 85.69s |

Both suites were green at baseline. The defects below are therefore **not**
caught by the existing tests — that is the point of recording them.

## Environment notes

- `pytest-timeout` is not installed; `--timeout=` is not a valid argument here.
- `tests/live/` and `tests/eval/` are excluded from the baseline: they require
  live network (sec.gov) and provider keys respectively. Classified
  `ENVIRONMENT`, not `PRODUCT_BUG`.
- Running `vitest` from the repository root picks up unrelated eval suites.
  Quick Answer's frontend baseline is `vitest run src/` inside `apps/market-ui`.
- `rg` is not on PATH; RTK falls back to direct exec. Cosmetic.

## Real file locations (documentation was partly stale)

The roadmap named files that do not all exist. Actual locations:

| Roadmap name | Actual |
|---|---|
| `apps/market-ui/src/hooks/useGravitySearch.ts` | exists — but it holds **types + the answer cleaner only**; the live WebSocket run lives in `apps/market-ui/src/stores/qaStore.ts` |
| `apps/market-ui/src/components/qa/` | exists — contains only `QaSearchProgress.tsx` and `FirecrawlScrapePanel.tsx` |
| `services/gravity-api/app/api/routes/search.py` | exists — WebSocket route at line 211 |
| `services/gravity-api/app/core/search_pipeline.py` | exists — 134KB, single file |
| `eval/` | exists at `services/gravity-api/eval/` (FinanceBench, FinQA, ALCE runners) |

## Defects found at baseline (each proven, not inferred)

### D1 — A fabricated citation was reported as verified  `PRODUCT_BUG`

`_normalize_citations` set `is_verified` to whatever the model reported as
`entailed`, with no check that the cited source exists. Probe against the real
function, five retrieved passages, model citing index 99:

```
FABRICATED -> [(99, '', True, '')]
```

`citation_number=99, chunk_id='', is_verified=True, document_title=''` — a
citation to a source that does not exist, carrying a verified flag the UI
renders as a green badge.

### D2 — The UI narrated providers that never ran  `PRODUCT_BUG`

`QaSearchProgress.tsx` held a hard-coded `LOG_LINES` array printed on a 650 ms
timer on every query:

```
'Dense vector search · Qdrant + voyage-finance-2…'
'Sparse BM25 keyword search · Elasticsearch…'
'SPLADE learned-sparse retrieval…'
'Knowledge-graph traversal · Neo4j…'
'Cross-encoder rerank · Cohere rerank-v3.5…'
```

None of these lines was conditioned on a backend event. The pipeline already
knew the truth — it emits `retrieval_channels` and `channels_dark` — and the UI
ignored it.

### D3 — The UI had a stage the backend never emits  `PRODUCT_BUG`

`SearchStatus` includes `validating`, and the progress bar assigns it 93%.
`grep -rn '"status": "validating"' app/` returns nothing: the backend never
emits it.

### D4 — Real backend stages were dropped by the UI  `PRODUCT_BUG`

The pipeline emits `resolving_primary_source` and
`answering_from_verified_evidence`. Neither string appears anywhere in
`apps/market-ui/src/`. `STATUS_STAGE[status] ?? -1` maps them to `-1`, so the
progress display collapsed to "no stage / 0%" mid-run on exactly the queries
that were consulting a primary source.

### D5 — Timestamps in the live log were fabricated  `PRODUCT_BUG`

Each log row rendered `new Date().toLocaleTimeString()` at render time, so
every row showed the current wall clock rather than when the step happened.

### D6 — The abstention state never reached the UI  `PRODUCT_BUG`

The pipeline emits `answer_state` (`UNSUPPORTED` / `SOURCE_UNAVAILABLE`) with
`confidence: "NONE"`. `grep -rn 'answer_state' apps/` returns nothing — the
frontend drops the field. `confidence` is typed `number` in the frontend while
the backend sends the string `"NONE"`.

### D7 — Cancellation was client-side only  `PRODUCT_BUG`

`cancelQa()` closes the browser socket and sets local status to `idle`. It
sends no cancel message, and the server's WebSocket loop does not read from the
socket while `async for event in pipeline.search(...)` is running, so nothing
could be received even if it did.

### D8 — Reconnect started a second expensive search  `PRODUCT_BUG`

`ws.onclose` reconnects up to 3 times with backoff, and `ws.onopen`
unconditionally re-sends the full query. The client generates a `trace_id` and
sends it, but the server's `search_stream` never reads it and never passes it to
the pipeline — so each reconnect is a brand-new billed search.
