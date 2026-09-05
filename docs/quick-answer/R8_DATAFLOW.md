# R8 QA-1 — the real Quick Answer path, and the three deciders

Roadmap §1. **No code was changed to produce this.** Every name below is
greppable; if a reader cannot find it, this document is wrong.

Measured at `7b7d3f4`, branch `feat/web-research-sec-integration`, working tree
clean, 2532 passing at the baseline commit `aa2440c`.

---

## 1. The lifecycle, with real names

```
user query
  │
  ▼  app/api/routes/search.py:212        @router.websocket("/search/stream")
     search_stream(websocket)             :213  — auth at :235-256, close 1008
SearchPipeline.search()                   app/core/search_pipeline.py:470
  │                                       (one generator, ~2000 lines, 19 yields)
  ├─ query understanding                  query_understander (injected boundary)
  ├─ semantic cache probe                 semantic_cache (injected boundary)
  │     └─ hit → gate_verdict_failed()    search_pipeline.py:97, called :744
  │              └─ yield answer          :751      ← publication path 1
  │              └─ yield metadata        :752, replay_metadata() :121
  ├─ retrieval                            retrieval_orchestrator (injected)
  │     └─ ChannelResults, per-channel failure map
  ├─ evidence gate                        SearchPipeline._evidence_gate() :426
  ├─ rerank                               reranker (injected boundary)
  ├─ yield sources / retrieval            :1310, :1382, :1403
  ├─ no-evidence branch
  │     └─ _gate_check()                  search_pipeline.py:181, called :1320
  │        └─ yield answer                :1327    ← publication path 2
  ├─ generation                           llm_router (injected boundary)
  │     ├─ _self_consistent_generate()    :360
  │     └─ yield token (stream)           :1674
  ├─ citation construction                _normalize_citations() :2762, called :2089
  │     └─ citation provenance            app/core/retrieval/citation_provenance.py
  │           provenance() :68  →  payload() :241  →  citation.update(payload(_prov))
  │                                       search_pipeline.py:2876, :2946
  ├─ answer contract + FinalGate          app/core/finance/answer_contract.py
  │     FinalGate :262, GateResult :250   _gate_check wraps FinalGate.check()
  │     └─ _gate_check()                  called :2107
  │        └─ yield answer                :2116    ← publication path 3
  ├─ yield structured_table               :2150
  ├─ cache write                          :2209, :2232
  │     └─ cache_provenance_of()          :71
  ├─ yield metadata                       :2264
  └─ yield error                          :2464
```

**The agentic delegation is a fourth publication path.** Line 794 is a bare
`yield event`, forwarding whatever `app/core/agents/orchestrator.py` emits,
including its own `answer` events. `_gate_check` is not called around it in this
function. It sits outside R8's scope fence (`reasoning_depth="fast"`), and it is
recorded here so that "there are three answer paths" is never written down as if
it were the whole truth.

### Publication sites, counted

| | count | lines |
|---|---|---|
| `yield SearchEvent` | 18 | — |
| bare `yield event` (delegation) | 1 | 794 |
| of those, `type="answer"` | **3** | 751, 1327, 2116 |
| `_gate_check` call sites | **2** | 1320, 2107 |
| `gate_verdict_failed` call sites | 1 | 744 |
| cache writes | 2 | 2209, 2232 |

Every one of the three `answer` yields has a gate immediately before it — 744
for the cache-hit path, 1320 for the refusal path, 2107 for the generated path.
**That is READ, not PROVEN**: the ordering was established by reading line
numbers, and QA-13 must prove it holds by executing each path. `SEARCH_STAGES`
(:152) names seven stages and is the stream contract's own vocabulary.

---

## 2. Decider 1 — is the real route tested?

**Partly, and the gap is specific.**

| What | Where | Verdict |
|---|---|---|
| Real FastAPI WebSocket against the real route, real run registry, real auth path, real cancel frame | `tests/test_search_stream_contract.py` | **PROVEN** — but it injects `FakePipeline` |
| Real `SearchPipeline` with only the external boundaries stubbed | `tests/test_quick_answer_pipeline_e2e.py` and ~9 others | **PROVEN** |

The pipeline tests inject `llm_router`, `retrieval_orchestrator`, `reranker`,
`query_understander`, `citation_validator` and `semantic_cache` — which are
exactly the "external dependencies that genuinely cannot run" that roadmap §21
permits. Citation construction, provenance, the answer contract, FinalGate and
the cache all execute for real.

**The gap: nothing joins the real route to the real pipeline.** The WebSocket
test substitutes the pipeline; the pipeline tests bypass the route. Roadmap §21
says *do not replace the component under test*, and for R8 the component under
test is the evidence path inside the pipeline — which is precisely what
`FakePipeline` replaces.

**Not blocked.** Both halves exist; QA-15 joins them.

---

## 3. Decider 2 — can performance be measured end to end?

**Partly. The split is not negotiable and must be reported as such.**

| Roadmap §22 measurement | Measurable here | Why |
|---|---|---|
| provenance construction | **yes** | pure, no external calls |
| FinalGate | **yes** | pure |
| serialization | **yes** | pure |
| cache hit | **yes** | the cache object is injected and real code runs |
| cache miss | **yes** | same |
| retrieval latency | **no** | needs Qdrant / Elasticsearch / Neo4j |
| answer-generation latency | **no** | needs a live LLM provider |
| end-to-end latency | **no** | is the sum of the two above plus the rest |

So p50/p95/p99 can be produced honestly for the pure stages and for the
pipeline's own overhead, and **cannot** be produced for retrieval, generation or
true end-to-end without live infrastructure.

**Consequence for certification:** roadmap §26's "performance measured
end-to-end" is `BLOCKED` on infrastructure unless the loop is given a live
stack. It is recorded as blocked now rather than discovered at the end. The
partial measurement is still worth taking, and QA-16 takes it — labelled for
what it is.

---

## 4. Decider 3 — which fixture dimensions exist?

**This is the one that constrains the round, and the answer is worse than the
manifests suggest.**

```
data/filings*/manifest.json     1408 rows, 218 tickers
                                forms: 10-K (1057), 10-Q (351)
                                amended (/A):            0
                                foreign (20-F/40-F/6-K): 0

actually on disk                  20 files, 3 tickers
                                ZTS 8 · AFL 6 · PNW 6
                                1388 manifest rows point at files not kept
```

Against roadmap §17:

| Required dimension | Status | Evidence |
|---|---|---|
| NVIDIA, Apple, Microsoft, Tesla | **not on disk** | absent from the 20 files; may exist as corpus chunks |
| United Airlines | **present as fixture text** | `tests/real_sec_fixtures.py` `UAL_RESULTS` |
| segmented company | **available** | `LYV_DEFERRED` is a real segment table; AFL, ZTS, PNW all report segments |
| non-USD-heavy company | **candidate, unverified** | AFL (Aflac) carries large Japan/yen operations and is on disk. It *reports* in USD, so it gives currency-translation disclosures, not a non-USD reporting currency |
| amended / restated example | **BLOCKED** | zero `/A` forms in 1408 manifest rows and zero on disk |

**The blocker, stated plainly.** Roadmap §17 forbids fabricating SEC data, and
there is no amended or restated filing in this repository. Therefore roadmap
§10 (restatement/amendment semantics) and the §26 criterion that conflicting
restated facts cannot become `VERIFIED` **cannot be demonstrated on real data as
the roadmap requires**. Three ways out, and the choice is the owner's:

1. **Supply one.** Any real `10-K/A` on disk closes it. This is the cheapest.
2. **Demonstrate the semantics on synthetic evidence and label it `UNPROVEN` on
   real data.** Honest, and weaker than the roadmap asks for.
3. **Record the criterion `BLOCKED`** and certify without it, naming it in the
   final report.

The same question applies more weakly to non-USD: AFL gives currency
*translation* text, not a foreign reporting currency. A single 20-F would close
that dimension properly.

---

## 5. What QA-1 did not do

- It did not open every one of the 19 yields' surrounding branches. The gate
  ordering above is `READ`. QA-13 and the §15 row must **execute** each path.
- It did not measure how many real citations carry provenance fields — the
  question R7's audit prompt named as the most valuable one outstanding. That
  needs the corpus, and belongs to QA-6.
- It did not inspect `app/core/agents/orchestrator.py`. The agentic path is out
  of the scope fence; only its existence as a publication route is recorded.

---

## 6. Owner decisions taken on the QA-1 findings

Both escalated before any code was written, because both change what the round
can claim at the end.

**Restated / amended fixture — synthetic, labelled `UNPROVEN` on real data.**
The restatement semantics of roadmap §10 get built and tested against
constructed evidence. The §26 criterion "conflicting evidence cannot become
VERIFIED" will be demonstrated for the logic and recorded as **`UNPROVEN` on
real filing data** in `R8_FINAL_AUDIT.md`, because no amended filing exists in
this repository and §17 forbids fabricating one. A single real `10-K/A` dropped
into `data/filings*/` upgrades it to `PROVEN` without touching the
implementation.

**Performance — bring up local infrastructure and populate it.** `make infra`
starts the stores; QA-16 seeds them and measures a real local end-to-end rather
than reporting only the pure stages. **The report must say "local", not
"production"** — local hardware, a local store population and a developer LLM
key are not the production environment, and a p95 measured here is evidence
about this machine. That caveat is a required sentence in `R8_FINAL_AUDIT.md`,
not an optional one.
