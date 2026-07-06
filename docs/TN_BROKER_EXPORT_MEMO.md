# TN Broker Export Formats — Shadow-Account Feasibility Memo (V5.1)

**Date:** 2026-07-06 · **Scope:** spec only, no build (Vibe-Trading harvest roadmap V5.1)
**Question:** can a Shadow Account import real portfolios from Tunisian brokers via a
CSV/statement standard?

## Verdict: NO-GO on a "standard import" · conditional GO on PDF-statement parsing

There is **no machine-readable export standard** (CSV/Excel/OFX/QIF/API) documented by any
surveyed Tunisian broker. The universal denominator is **PDF statements**. A shadow-account
import is feasible only as (a) manual position entry, then (b) a per-broker PDF-statement
parser — the same PDF→LLM extraction pattern already proven in our TN fundamentals pipeline
(`scripts/tn_fundamentals.py`, DeepSeek-extracted financial statements).

## Survey evidence (public sources, 2026-07-06)

| Broker / infra | Platform | What's documented | Machine-readable? |
|---|---|---|---|
| **Tunisie Valeurs** (#2 by 2024 volume) | Tval Trade (web) + Tval Mobile | App Store listing: save "statements/portfolio/stock exchange orders **in PDF format**"; quarterly account statement (composition + valuation); document requests (CEA cert., securities ownership cert.) also PDF | **No** — PDF only, explicitly |
| **BNA Capitaux** (bank-owned) | Bourse Connect via BN@tic / eBanking | "consultation du portefeuille, téléchargement des relevés, notifications temps réel" — format unspecified; bank relevé norm is PDF | **No evidence** of anything but PDF |
| **MAC SA** (#1 by 2024 volume, 27.86% share) | MAC Online | Real-time market access + securities-account view; no export feature documented publicly | **No evidence** |
| **Tunisie Clearing** (central depository) | TANIT CSD | T+3 règlement/livraison; integrity control across account-holding banks/brokers; rules are **interbank**, not client-facing | **N/A** — no retail data interface |
| Regulator (CMF/BVMT) | — | Règlement Général covers brokerage conduct; no client-data-portability rule (no PSD2/open-banking equivalent for TN securities accounts) | **No mandate exists** |

Sources: [Tval Mobile — App Store](https://apps.apple.com/tn/app/tval-mobile/id1332463714),
[Tunisie Valeurs compte titres](https://www.tunisievaleurs.org/site/fr/compte-titres.34.html),
[Tunisie Valeurs FAQ](https://www.tunisievaleurs.com/en/faq-2/) (checked: no format info),
[BNA Capitaux](http://www.bnacapitaux.com.tn/), [Groupe BNA](http://www.bna.tn/fr/groupe-bna.538.html),
[MAC SA](https://www.macsa.com.tn/), [Tunisie Clearing règles de fonctionnement](https://www.tunisieclearing.com/upload/202103/2ef87dd5-586c-41b6-910b-10fe91aca297.pdf),
[CMF Règlement Général de la Bourse](https://www.cmf.tn/sites/default/files/pdfs/reglementation/textes-reference/reg_bourse_fr.pdf),
[Top-3 brokers 2024 — WMC](https://www.webmanagercenter.com/2025/01/04/537661/top-3-des-intermediaires-en-bourse-2024-mac-sa-tunisie-valeurs-et-maxula-bourse/).

## Why NO-GO on a standard

1. No broker documents CSV/Excel/API export; the only explicit format statement found is
   Tunisie Valeurs' **PDF**.
2. No regulatory portability mandate — nothing forces brokers to expose data, and TN has no
   open-banking regime covering securities accounts.
3. TANIT (Tunisie Clearing) is a depository system between institutions; retail clients never
   touch it.
4. Screen-scraping broker portals (Tval Trade etc.) would need per-broker credentials handling —
   security liability far above the feature's value, and ToS-fragile.

## Conditional GO — the workable path (if Shadow Account is ever prioritized)

1. **V1 manual:** position entry form (symbol, qty, cost basis) — zero dependency, works today;
   valuations already live via `/api/tn/markets`.
2. **V2 PDF import:** parse the quarterly/on-demand PDF statements of the top 2 brokers by
   volume (MAC SA, Tunisie Valeurs — together ~46% of 2024 traded capital). Reuse the
   fundamentals PDF→LLM extraction pipeline with a sanity guard (positions must sum against
   stated valuation). Needs REAL sample statements from actual accounts before any build —
   layouts are unverified until then (none are published publicly, consistent with the finding
   above).
3. **Never:** credentialed scraping of broker portals.

**Acceptance note:** no real statement samples could be published here because none exist
publicly — that absence is itself the documented finding; per-broker layouts require client
account access.
