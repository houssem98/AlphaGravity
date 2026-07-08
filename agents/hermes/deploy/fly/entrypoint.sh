#!/bin/sh
# Rebuild ~/.hermes/.env from Fly secrets (injected as env vars), clear any
# stale gateway lock the committed snapshot carried, then run the gateway in
# the foreground (PID 1) so Fly restarts it if it ever exits.
set -e
cd /root/.hermes

: > .env
for k in DEEPSEEK_API_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY \
         TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USERS TN_BASE; do
  eval "v=\$$k"
  [ -n "$v" ] && echo "$k=$v" >> .env
done

rm -f gateway.lock gateway.pid gateway_state.json cron/.tick.lock

exec hermes gateway
