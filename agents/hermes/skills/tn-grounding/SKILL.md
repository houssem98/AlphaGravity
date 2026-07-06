---
name: tn-grounding
description: MANDATORY grounding policy for all Tunisia (BVMT/TSE) and market data questions - every price, index level, volume, ratio or any other market number MUST come from a curl of an allowlisted endpoint executed in THIS conversation turn, never from memory or training data
version: 1.0.0
author: antigravity
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [BVMT, TSE, Tunisia, Grounding, Market Data, Safety, Policy]
---

# TN Grounding Policy (mandatory)

## When to Use This Skill

ALWAYS, whenever the user asks about any market number: a stock price
(e.g. BIAT, SFBT, TINV), the TUNINDEX or any index level, volumes, bid/ask,
market cap, PER/EPS/PB ratios, session dates, movers, or anything derived
from market data.

## The Policy (non-negotiable)

1. **Curl-then-report only.** Every market number you state MUST be read from
   the response body of an HTTP request you executed with the terminal tool
   in the CURRENT turn. Quote the number exactly as the payload gives it.
2. **Never answer market numbers from memory**, training data, or earlier
   conversation turns. Prices move; your memory is stale by definition.
   Memory is for procedure (how to fetch), never for values.
3. **Endpoint allowlist.** You may only fetch market data from:
   - `https://market-ui-self.vercel.app/api/*` (our product API)
   - `https://www.bvmt.com.tn/*` and `https://bvmt.com.tn/*` (exchange)
   - `https://tunis-stockexchange.com/*` (TSE Grafana cross-check)
   No other host is a valid source for TN market numbers.
4. **If the fetch fails** (network blocked, timeout, non-200, empty body):
   REFUSE to give a number. Say the data source is unreachable and that you
   will not report prices from memory. Offering to retry is fine.
   Fabricating, estimating, or "approximately X from what I recall" is a
   policy violation.
5. **Always cite the séance/date** field from the payload next to the number
   so the user knows which session it belongs to.

## How to Fetch

- All listed equities snapshot (price, change %, volume, bid/ask, séance):
  `curl -s "https://market-ui-self.vercel.app/api/tn/markets"`
  → JSON `{rows: [{symbol, name, price, changePct, volume, bid, ask, seance, ...}]}`
- One symbol: fetch the same endpoint, then select the row whose `symbol`
  matches (e.g. BIAT).

## Example

User: "What is BIAT trading at?"
1. `curl -s "https://market-ui-self.vercel.app/api/tn/markets"`
2. Find `"symbol":"BIAT"` row, read `price` and `seance`.
3. Answer: "BIAT is at <price> TND (séance <seance>, change <changePct>%)."

If step 1 fails → "I can't reach the market data endpoint right now, and the
grounding policy forbids me from quoting prices from memory. Want me to retry?"
