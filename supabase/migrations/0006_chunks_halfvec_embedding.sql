-- 0006 — dense retrieval comes back on the free tier (GS-5).
--
-- The Qdrant cluster that held ~1.5M vectors was deleted for inactivity and the
-- data is unrecoverable; `dense_search.py` has been failing silently into [] ever
-- since, which is why prod answers from two channels instead of ten.
--
-- halfvec(512), not vector(1024): float16 halves the bytes, and voyage-3.5-lite is
-- matryoshka-trained so 512 is a supported truncation rather than a lossy crop.
-- 18,445 chunks land at roughly 19 MB against a 500 MB free tier already 294 MB
-- used (§4 caps the loop at 450 MB). voyage-finance-2 — the embedder the lost
-- vectors used — refuses any dimension but 1024, which would not fit the budget.
--
-- Applied to prod 2026-08-18.

create extension if not exists vector;

alter table public.chunks add column if not exists embedding halfvec(512);

-- No index here on purpose: HNSW is built after the backfill (migration 0007), so
-- the 18,445 updates do not each pay the insert cost.
comment on column public.chunks.embedding is
  'voyage-3.5-lite @ 512 dims, cosine. Index built after backfill (migration 0007).';
