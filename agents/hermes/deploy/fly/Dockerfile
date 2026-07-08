# Fly image for the Hermes TN daemon. Base = a snapshot of the working local
# container (`docker commit hermes-daemon hermes-daemon:flybase`) which already
# has hermes installed plus our scripts/skills/cron jobs.json baked in.
# This layer only: strips the committed secrets + stale runtime locks, and adds
# an entrypoint that rebuilds .env from Fly secrets on boot.
FROM hermes-daemon:flybase

# Never ship secrets or stale gateway locks inside the image.
RUN rm -f /root/.hermes/.env \
          /root/.hermes/gateway.lock \
          /root/.hermes/gateway.pid \
          /root/.hermes/gateway_state.json \
          /root/.hermes/cron/.tick.lock \
          /root/.hermes/auth.lock || true

COPY entrypoint.sh /usr/local/bin/hermes-entrypoint.sh
RUN chmod +x /usr/local/bin/hermes-entrypoint.sh

ENV TZ=Africa/Tunis
ENTRYPOINT ["/usr/local/bin/hermes-entrypoint.sh"]
