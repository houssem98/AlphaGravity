#!/usr/bin/env bash
# Self-improving deep research harness.
# Runs performDeepResearch in a loop until judge score >= 7 on all dimensions (or max 3 iterations).
# Usage:
#   VITE_API_URL=http://localhost:3002 VITE_DEV_AUTH_BYPASS=true bash LOOP_SELF_IMPROVE.sh "query here" [model]
#
# Example:
#   bash LOOP_SELF_IMPROVE.sh "Nvidia data center roadmap 2026" deepseek-chat
#
# Outputs JSON log to LOOP_RESULTS.json with full telemetry per iteration.

set -eu

QUERY="${1:?Usage: LOOP_SELF_IMPROVE.sh <query> [model]}"
MODEL="${2:-deepseek-chat}"
API="${VITE_API_URL:-http://localhost:3002}"
MAX_ITER=3
MIN_SCORE=7.0
OUT_FILE="LOOP_RESULTS.json"

# Log path
mkdir -p loop-out
LOG="${PWD}/loop-out/$(date +%Y%m%d-%H%M%S).json"

echo "🔁 LOOP START: query='$QUERY' model=$MODEL max_iter=$MAX_ITER"
echo "📊 Logging to: $LOG"

# Harness: call eval runner for each iteration, parse results, decide to loop.
# The eval runner is in apps/market-ui/eval/drEval.test.ts but reusable via:
#   npm run eval:loop -- --query="..." --model=...
# For MVP: just call performDeepResearch + judge via market-server endpoint.

cd ./apps/market-ui

# Run the self-improve loop via Vitest (reuses drEval infrastructure).
LOOP_QUERY="$QUERY" LOOP_MODEL="$MODEL" LOOP_MAX_ITER="$MAX_ITER" LOOP_MIN_SCORE="$MIN_SCORE" \
  npm run eval:loop 2>&1 | tee "${LOG}"

echo ""
echo "✅ Loop complete. Results: ${LOG}"
echo "📈 Summary:"
jq '.summary' "${LOG}" 2>/dev/null || echo "(parse failed)"
