# Personal Website Roadmap

Founder portfolio for houssem98. Showcases all GitHub projects (AlphaGravity + prior work). Built from GitHub API + project artifacts.

## Phase 1: Foundation (Week 1)
- [ ] Domain + hosting (Vercel)
- [ ] Hero: tagline + live demo embed (market-ui-self.vercel.app iframe)
- [ ] About: founder bio + photo
- [ ] Tech stack visual (4-icon row: React, FastAPI, Qdrant, Postgres)

## Phase 2: Showcase (Week 2)
- [ ] Live features carousel: Search → Deep Research → Trading Hub → BVMT
- [ ] GitHub repo link + star count badge
- [ ] Product screenshots (4x before/after: research quality, speed, coverage)
- [ ] Testimonial slot (investor/beta user quote)

## Phase 3: Traction (Week 3)
- [ ] Metrics card: markets covered, filings indexed, users, query volume
- [ ] Recent commits feed (auto-pull from GitHub API)
- [ ] Roadmap: next 6 months (from ROADMAP_PROGRESS.md)
- [ ] Press/mentions (LinkedIn, TechCrunch, etc. if any)

## Phase 4: Engagement (Week 4)
- [ ] Email signup (Mailchimp or Supabase)
- [ ] Demo request CTA
- [ ] Social links (Twitter, LinkedIn, GitHub)
- [ ] Blog/insights feed (pull from docs/ or Medium)
- [ ] Dark mode toggle (match market-ui theme)

## Stack

| Layer | Tech |
|---|---|
| Hosting | Vercel |
| Framework | Next.js 15 (reuse market-ui patterns) |
| Content | Markdown in `/docs/website/` |
| Auth | Supabase (future: waitlist gating) |
| Analytics | Vercel Analytics |

## Key files to reference

- `ROADMAP_PROGRESS.md` — live roadmap
- `README.md` — project overview
- `docs/` — architecture, technical deep dives
- GitHub API — commit history, issues, releases
- market-ui screenshots — product visuals

## Success metrics

- Lighthouse: 95+ (Core Web Vitals)
- Time to interactive: <2s
- Bounce rate: <40%
- Demo request CTR: >5%
- Email signup: >100 by week 4
