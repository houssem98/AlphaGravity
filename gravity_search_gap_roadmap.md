# Gravity Search — Roadmap to Close the Gaps

This is sequenced by blast radius and dependency, not calendar time — I have no visibility into your team size or velocity, so I'm not going to invent dates. Every item below is anchored to something specific I found in the 33 files I read; where I'm making a judgment call rather than citing a fact, I've said so.

## Phase 0 — Stop the silent degradation (do first, cheapest, highest leverage)

These don't require new capability, just making the existing gap visible instead of hidden.

1. **Surface channel health in the response metadata.** `RetrievalOrchestrator.search()` already returns `dict[channel_name → list[RetrievalResult]]` and the pipeline already yields a `metadata` `SearchEvent` at Stage 10. Add which channels were active/empty for *this specific query* to that payload. Right now a user gets the same-looking answer whether 9 channels or 2 contributed — that's the single biggest trust gap, and it's a small change because the data already flows through the system.
2. **Decide, explicitly, the fate of ES/Neo4j/Redis/SPLADE.** Per your own `ANALYZE_PROMPT.md`, these were down at that snapshot. Either restore them or formally deprecate the code paths (`sparse_search.py`, `graph_search.py`, `splade_search.py`) so the team stops maintaining and reasoning about channels that aren't running. Silent `except: return []` fallbacks (present in all three of those files) are fine for runtime resilience but bad for engineering clarity if nobody's tracking that they're permanently dark.
3. **Kill or fix the agentic-mode bug, don't leave it half-dead.** `search_pipeline.py` has a dated comment saying it's gated off because it returns empty answers. Right now `agents/` (9 files, real complexity) is a maintenance liability with zero production value. This is a bounded debugging task — trace why `ctx.extracted_facts`/`ctx.final_answer` isn't reaching the Writer in `agents/orchestrator.py` — not a rewrite. Until someone does that, it should be documented as "known broken, do not re-enable" rather than silently gated by a settings flag that could get flipped by accident.

## Phase 1 — Add the missing primary source (SEC EDGAR)

This is the specific gap you asked about. Two viable shapes, both discussed last turn:

- **New retrieval channel** (`retrieval/edgar_search.py`): implement the same `async def search(query, filters, top_k) -> list[RetrievalResult]` contract every other channel uses. Internally: ticker→CIK resolution, `companyconcept`/`companyfacts` XBRL pull, convert each fact to a `RetrievalResult` with `document_title`, `filing_date`, `ticker`, `source_url` pointing at the EDGAR filing index. Register it in `RetrievalOrchestrator.__init__` next to the existing channels so it's included in the `asyncio.gather()` fan-out and in RRF fusion — `fusion.py` already scores `sec.gov` at authority 10, it's just never had a live document to score.
- **MCP tool**, reusing `mcp_client.py`/`mcp_retrieval.py`'s existing generic tool-selection and result-conversion logic — less new code, since `MCPRetrievalChannel` is already generic across providers.

My recommendation: build it as a first-class retrieval channel, not an MCP tool. EDGAR's XBRL API returns exact, structured, machine-checkable numbers (not free text a model has to interpret) — that deserves the same "deterministic, pinned" treatment your `search_pipeline.py` docstring says the single-pass path already gives XBRL facts for complex queries. Routing it through the generic MCP text-extraction path would flatten that structure back down to prose and lose the thing that makes EDGAR data valuable in the first place.

Either way, this is the fix that actually answers your earlier question — a CLAUDE.md can't touch `retrieval/orchestrator.py`; this can.

## Phase 2 — Make the LLM layer defensible, not just cheap

Your own router comments already document the problem precisely: Anthropic credits exhausted, Groq's free tier ~98% self-consumed by midday, DeepSeek first-choice across every complexity tier despite "already hallucinates ~18%" per the code comment, and self-consistency disabled because DeepSeek is too slow to run 3x within budget. Two independent fixes, either helps without the other:

- **Funding fix**: restore paid access to a fast, low-hallucination model for at least the SIMPLE/MEDIUM tiers (70%+20% of traffic per the router's own complexity distribution comment) so the cheapest, most common queries aren't the ones routed to the highest-hallucination-risk model. This is a budget decision, not an engineering one — I'm flagging it because the code comments make clear the current routing is a workaround for a funding gap, not a considered quality choice.
- **Grounding fix (doesn't require new spend)**: for any fact that comes from a deterministic source — the EDGAR channel from Phase 1, the existing "pinned XBRL facts" the docstring mentions, or the Stage 5b/5c ratio/calculator pre-pass — the LLM should be constrained to echo the value verbatim rather than re-derive or paraphrase it. This narrows the surface area where a hallucination-prone model can actually introduce an error, independent of which model is in the router seat that day.

## Phase 3 — Re-enable agentic mode, scoped

Once the Phase 0 bug is actually fixed (not just gated), don't flip it back on globally. The Critic/Verifier/rubric machinery in `agents/` is real, well-built, and wasted sitting dark — but single-pass already handles the 92% of traffic that's SIMPLE/MEDIUM per the router's stated distribution. Re-enable agentic mode specifically for COMPLEX/MATH queries (the 10% where multi-hop decomposition and the Verifier's arithmetic cross-checks earn their extra latency and cost), gated behind real before/after eval numbers — see Phase 4 — not a blanket flag flip.

## Phase 4 — Close the test gap

Your own `ANALYZE_PROMPT.md` already asks for this ("TEST PLAN: unit tests + golden-output assertions for the fusion + citation stages") — it's a known, admitted gap, not something I'm inventing. Concretely:

- Golden-output regression tests for `fusion.py`'s RRF+authority scoring and for the citation validation stages (7b/7c/8b) — these are the stages where a silent regression does the most damage, since they're the trust layer.
- The router's own comments reference a FinanceBench-style eval already having been run once (the "23/150 FinanceBench Qs timed out" stat implies some eval harness exists or existed). Formalize that into a CI-gated regression suite, so future model/prompt changes get measured against it automatically instead of ad hoc.
- Use this suite as the actual acceptance gate for Phase 3's re-enablement, rather than shipping the agentic path on faith that the empty-answer bug is the only thing wrong with it.

## What I'm not going to pretend to know

I don't have your team's headcount, so I can't tell you if this is two weeks or two quarters of work. I don't know the current (post-July-snapshot) live status of ES/Neo4j/Redis/SPLADE or whether PageIndex/TurboQuant/GDELT/MCP are actually serving traffic yet — Phase 0 exists partly to make that visible going forward instead of something I have to infer from a dated internal doc. And I have no accuracy/latency numbers of my own — every severity judgment above is anchored to a comment or docstring your own team already wrote, not an external benchmark I ran.
