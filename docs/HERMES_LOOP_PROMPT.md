# Hermes Loop Prompt

Reusable `/loop` prompt for the Hermes trading roadmap. Invoke with:

```
/loop <contents of the prompt below>
```

## Prompt

Read docs/HERMES_TRADING_ROADMAP.md and follow its hard rules exactly. Do only the first unchecked [ ] task after reading the files/repos it names. Hard rules: every Hermes capability claim verified against github.com/NousResearch/* (GitHub API or raw README) before building on it — never trust hermes-*.net/.agency/.org lookalike domains, install only from the GitHub repo; agent numbers only from same-run curls of our prod endpoints or BVMT/TSE feeds, never from agent memory; prod stays read-only to the agent, all code/prompt changes via PR; new TN surface only inside api/tn/[fn].ts routes or Supabase Storage blobs (12-fn cap); no new market-ui deps. Verify: UI/endpoint tasks need tsc 0 + market-ui build + curl prod; daemon tasks (H0-H2) need real command output/payload evidence pasted into the log; H0.1 must prove DeepSeek actually works as provider before any later task assumes it. Flip to [x], one Progress-log line with REAL numbers, commit on roadmap/world-class (git commit -F file if the message has quotes — rtk mangles them). vercel --prod --yes only when a task ships UI/endpoint changes (H4.2). H2 constraint: live BVMT book capture only Mon–Fri 09:00–14:00 Tunis. PERSISTENCE: this loop must survive usage/rate limits — never end the loop because of a limit, quota, 429, or overloaded error; on any such error, stop consuming tokens immediately, ScheduleWakeup at the maximum delay (3600s) with this exact /loop prompt, and on wake re-read the ledger and resume the same task from its last verified step (the ledger + Progress log are your recovery state, so log partial progress BEFORE long/risky operations); chain hourly wakeups as many times as needed until work succeeds again. Only stop for: no [ ] remaining, or a task blocked on credentials/infra only the user can provide — then say exactly what's needed and still ScheduleWakeup (3600s) so the loop resumes if the user supplies it.
