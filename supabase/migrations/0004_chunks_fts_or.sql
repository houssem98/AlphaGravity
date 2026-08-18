-- The keyword channel returned 0 results for every real query. websearch_to_tsquery
-- ANDs bare words, and sparse_search.py appends up to 6 synonyms to the query
-- string, so the tsquery was a 10-15 term conjunction that matched nothing.
-- Measured on NVDA (1,485 chunks): "competition" 81 hits, "competitive risks" 50,
-- the full question 8, the question+synonyms prod actually sends 0.
--
-- Fix: OR the lexemes instead of ANDing them, and let ts_rank do the selecting.
-- Same query now matches 1,055 and ranks Item 1A. Risk Factors first. Synonyms
-- become the OR terms the caller always intended.
--
-- to_tsquery('simple', ...) — the lexemes come out of to_tsvector('english', ...)
-- already stemmed, so re-stemming them under 'english' would be a no-op at best.
--
-- distinct on (md5(text)): duplicate ingests left 13.6% of rows byte-identical
-- (AAPL 78.7%, NVDA 75.4%), and the old top-5 for a risk-factors query was the
-- same paragraph five times. Dedupe before the limit so k slots hold k passages.

create or replace function public.search_chunks_fts(
    q        text,
    tickers  text[] default null,
    k        integer default 50
)
returns table (
    id text, document_id text, ticker text, company text,
    document_title text, filing_type text, filing_date text,
    section text, page integer, text text, rank real
)
language sql stable as $$
    with tq as (
        select to_tsquery(
                   'simple',
                   (select string_agg(quote_literal(lexeme), ' | ')
                      from unnest(tsvector_to_array(to_tsvector('english', q))) as lexeme)
               ) as query
    ),
    hits as (
        select distinct on (md5(c.text))
               c.id, c.document_id, c.ticker, c.company,
               c.document_title, c.filing_type, c.filing_date,
               c.section, c.page, c.text,
               ts_rank(c.tsv, tq.query) as rank
        from public.chunks c, tq
        where tq.query is not null
          and c.tsv @@ tq.query
          and (c.chunk_level = 2 or c.chunk_level is null)
          -- Ticker scope is now REQUIRED. Unscoped, the OR query matches a large
          -- fraction of 478k chunks and ts_rank has to detoast every match: the
          -- unscoped form ran 122s before hitting the statement timeout, while
          -- scoped runs ~4s. An unscoped call returns nothing rather than
          -- burning the request budget and timing out.
          and array_length(tickers, 1) is not null
          and c.ticker = any(tickers)
        order by md5(c.text), ts_rank(c.tsv, tq.query) desc
    )
    select * from hits order by rank desc limit k;
$$;
