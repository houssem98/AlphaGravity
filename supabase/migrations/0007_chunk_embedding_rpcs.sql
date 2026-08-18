-- 0007 — the write and read paths for the halfvec column added in 0006 (GS-5).
--
-- set_chunk_embeddings: one round trip per embedding batch. The alternative was
-- 18,445 individual PATCHes, or a PostgREST upsert that has to send every NOT NULL
-- column back just to set one.
--
-- match_chunks: the dense channel's reader. Ticker scope is a parameter because
-- cosine similarity will cheerfully return another company's paragraph, and every
-- other channel here treats unscoped cross-company retrieval as a bug.
--
-- Both are SECURITY DEFINER and granted to service_role only — revoked from anon
-- and authenticated, like gravity_db_stats() in 0005. RLS on chunks is enabled
-- with zero policies, which IS the security model; a definer function that skipped
-- these revokes would hand the browser the whole corpus.
--
-- Applied to prod 2026-08-18.

create or replace function public.set_chunk_embeddings(p_ids text[], p_vecs text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0;
begin
  update chunks c
     set embedding = v.vec::halfvec(512)
    from (select unnest(p_ids) as id, unnest(p_vecs) as vec) v
   where c.id = v.id;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.set_chunk_embeddings(text[], text[]) from public;
revoke all on function public.set_chunk_embeddings(text[], text[]) from anon;
revoke all on function public.set_chunk_embeddings(text[], text[]) from authenticated;
grant execute on function public.set_chunk_embeddings(text[], text[]) to service_role;

create or replace function public.match_chunks(
  p_query halfvec(512),
  p_tickers text[] default null,
  p_limit integer default 20
)
returns table (id text, ticker text, text text, similarity double precision)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.ticker, c.text,
         1 - (c.embedding <=> p_query) as similarity
    from chunks c
   where c.embedding is not null
     and (p_tickers is null or c.ticker = any(p_tickers))
   order by c.embedding <=> p_query
   limit greatest(p_limit, 1)
$$;

revoke all on function public.match_chunks(halfvec, text[], integer) from public;
revoke all on function public.match_chunks(halfvec, text[], integer) from anon;
revoke all on function public.match_chunks(halfvec, text[], integer) from authenticated;
grant execute on function public.match_chunks(halfvec, text[], integer) to service_role;
