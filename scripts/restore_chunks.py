"""Restore chunks from the gzipped JSONL archive back into Supabase.

  python restore_chunks.py <archive.jsonl.gz>              # everything
  python restore_chunks.py <archive.jsonl.gz> NVDA AMD ...  # only these tickers

Upserts on id, so re-running is safe. `tsv` is a GENERATED column and is
recomputed by Postgres on insert -- do not send it.
"""
import gzip, json, os, sys, time, urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ARCHIVE = sys.argv[1]
WANTED = {t.upper() for t in sys.argv[2:]}
BATCH = 500


def push(rows):
    body = json.dumps(rows, ensure_ascii=False).encode()
    req = urllib.request.Request(
        f"{URL}/rest/v1/chunks",
        data=body,
        method="POST",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Content-Type": "application/json", "User-Agent": "curl/8",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.status
        except Exception as e:
            if attempt == 4:
                raise
            print(f"  retry {attempt+1}: {e}", flush=True)
            time.sleep(2 * (attempt + 1))


t0 = time.time()
sent = skipped = 0
buf = []
with gzip.open(ARCHIVE, "rt", encoding="utf-8") as f:
    for line in f:
        row = json.loads(line)
        if WANTED and (row.get("ticker") or "").upper() not in WANTED:
            skipped += 1
            continue
        row.pop("tsv", None)
        buf.append(row)
        if len(buf) >= BATCH:
            push(buf); sent += len(buf); buf = []
            if sent % 20000 < BATCH:
                print(f"{sent} rows | {time.time()-t0:.0f}s", flush=True)
if buf:
    push(buf); sent += len(buf)

print(f"DONE restored={sent} skipped={skipped} in {time.time()-t0:.0f}s")
