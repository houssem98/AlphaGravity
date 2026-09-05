# Why Quick Answer's answer accuracy has never been measured

An attempt was made, after R8 closed, to produce the accuracy number the final
audit says is missing. It failed for a concrete and checkable reason, recorded
here so the next round does not repeat the attempt from scratch.

**Conclusion: FinanceBench cannot be run against this repository's data.**
`BLOCKED`, not `UNPROVEN` — the blocker is identified and fixable.

---

## 1. The existing 16% is not an accuracy measurement

`eval/data/results_dev_2026-08-18.json` records 10 correct / 60 = 16.7%. It has
been cited as this system's accuracy. It is not.

**All 60 answers are the same string**: `"No indexed documents found. To get
answers, ingest the relevant SEC filings..."` `PROVEN`

- 22 prose questions are ungraded (`correct: None`)
- the 10 "correct" are 5 boolean + 5 numeric that matched a refusal string by
  accident

It measures an empty index. Nothing about it describes the pipeline.

---

## 2. Two of the four grader modes cannot run at all

| mode | blocker | state |
|---|---|---|
| `gold_context` | `financebench_150.json` has **no `evidence` field**, and `/v1/search` accepts **no `context` or `disable_retrieval` parameter**. `call_gold_context` posts fields the API schema ignores. | `PROVEN` broken |
| `closed_book` | runnable, but measures the LLM's memory rather than the pipeline | not useful |
| `retrieval_only` / `agentic` | require a corpus containing FinanceBench's documents — see §3 | `BLOCKED` |

The LLM judge is also dead: `llm_judge` calls `claude-sonnet-4-6` and the key
returns **HTTP 401**. `PROVEN` Only numeric questions grade
deterministically, via `numeric_match`; prose and boolean cannot be graded.

---

## 3. The corpus is the wrong vintage — 0 of 24

The corpus backup (`chunks_full.jsonl`, 478,433 chunks) covers **21 of 32**
FinanceBench companies, which looks promising and is not.

    FinanceBench asks about   2015 – 2023 filings
    the corpus contains       2022(290) 2023(469) 2024(697)
                              2025(3267) 2026(6235)

Measured per question, on the most favourable subset that could be constructed
— the 24 numeric questions whose company appears in the corpus:

**Questions whose required filing year exists in the corpus: 0 of 24.**
`PROVEN`

    Adobe            ADOBE_2015_10K     corpus has 2025, 2026
    Amazon           AMAZON_2017_10K    corpus has 2024, 2025, 2026
    Nike             NIKE_2018_10K      corpus has 2025, 2026
    Microsoft        MICROSOFT_2016_10K corpus has 2025, 2026
    ... 20 more, all the same shape

Company overlap without document overlap. Running the benchmark now would
return approximately zero and would measure the corpus, exactly as the
2026-08-18 run did.

---

## 4. What would actually produce a number

Two options, in order of directness.

**A. Ingest FinanceBench's own document set.** The benchmark publishes the
10-Ks it asks about. Fetching those ~150 filings and indexing them makes
`retrieval_only` meaningful. Cost is the ingestion; the embedding key
(`voyage-finance-2`) is live but **rate-limited — HTTP 429 at batch scale**,
so pace accordingly.

**B. Build a benchmark from the filings this repo already has.** The corpus is
2022–2026 and holds real 10-Ks. Gold answers can be derived from XBRL facts,
which are exact by construction. This measures the same pipeline on data that
is present, and avoids depending on an external dataset's vintage.

Either way, prose and boolean grading needs a working judge. The Anthropic key
401s; DeepSeek is live and could serve as the judge, at the cost of a weaker
grader than the spec assumes — and per the loop standard, a model-graded stop
needs a trial count, not a single call at a fixed threshold.

---

## 5. What this means for R8's certification

Nothing in R8 changes. The final audit already states that answer accuracy was
never measured and declines to certify partly for that reason. This document
upgrades that claim from `UNPROVEN` to `BLOCKED` and names the blocker.

The honest summary remains: **the verification layer is measurably harder to
fool than it was 42 commits ago, and nobody has demonstrated the system answers
questions correctly.** The second half is not a suspicion — it is an
unmeasured quantity, and now a specifically explained one.
