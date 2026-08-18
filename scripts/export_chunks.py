"""Export the Supabase `chunks` table to gzipped JSONL. Keyset pagination on id, resumable."""
import gzip, json, os, sys, time, urllib.parse, urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OUT = sys.argv[1]
STATE = OUT + ".last_id"

COLS = ("id,document_id,ticker,company,document_title,filing_type,filing_date,"
        "section,page,chunk_level,text,created_at")
BATCH = 1000

last_id = open(STATE).read().strip() if os.path.exists(STATE) else ""
rows_done = int(open(STATE + ".count").read().strip()) if os.path.exists(STATE + ".count") else 0
mode = "at" if last_id else "wt"


def fetch(after):
    q = {"select": COLS, "order": "id.asc", "limit": str(BATCH)}
    if after:
        q["id"] = f"gt.{after}"
    req = urllib.request.Request(
        f"{URL}/rest/v1/chunks?" + urllib.parse.urlencode(q),
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Accept-Profile": "public", "User-Agent": "curl/8"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == 4:
                raise
            print(f"  retry {attempt+1} after {e}", flush=True)
            time.sleep(2 * (attempt + 1))


t0 = time.time()
with open(OUT, mode, encoding="utf-8", newline="\n") as fh:
    while True:
        rows = fetch(last_id)
        if not rows:
            break
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        last_id = rows[-1]["id"]
        rows_done += len(rows)
        open(STATE, "w").write(last_id)
        open(STATE + ".count", "w").write(str(rows_done))
        if rows_done % 20000 < BATCH:
            fh.flush()
            mb = os.path.getsize(OUT) / 1e6
            print(f"{rows_done} rows | {mb:.0f} MB raw | {time.time()-t0:.0f}s", flush=True)
        if len(rows) < BATCH:
            break

print(f"FETCHED {rows_done} rows | {os.path.getsize(OUT)/1e6:.1f} MB raw | {time.time()-t0:.0f}s", flush=True)

with open(OUT, "rb") as src, gzip.open(OUT + ".gz", "wb", compresslevel=6) as dst:
    while chunk := src.read(8 << 20):
        dst.write(chunk)
print(f"DONE {rows_done} rows | {os.path.getsize(OUT + '.gz')/1e6:.1f} MB gz | {time.time()-t0:.0f}s")
