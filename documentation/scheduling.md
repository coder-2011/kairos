# Scheduling and cron

Kairos uses one production cron entry to wake the durable job runner:

- Vercel path: `/api/jobs/drain`
- Local API route after the Vercel adapter strips `/api`: `/jobs/drain`
- Method: `GET`
- Schedule: `*/5 * * * *`
- Timezone: UTC, per Vercel cron semantics

The cron route does two things in order:

1. Enqueue due scheduled heartbeat runs for enabled branches whose heartbeat
   timing window is active and whose cadence has elapsed.
2. Drain pending durable jobs for heartbeat, debate, Deep Research, and broker
   sync runs.

Vercel invokes cron jobs only for production deployments and sends
`Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is configured. Kairos
requires `CRON_SECRET` for production cron drains.

## Heartbeat timing

- Default heartbeat schedule is open-market weekdays, 09:30-16:00
  `America/New_York`.
- Cron itself runs in UTC, but each branch heartbeat timing is evaluated in the
  branch's configured timezone.
- Invalid timezones are treated as inactive so one bad branch cannot break the
  scheduler.
- Router-origin messages can wake heartbeat agents immediately, but still only
  for branches whose heartbeat is enabled and active in the configured timing
  window.

## Operational notes

- The five-minute Vercel cron cadence is intended to match Kairos's default
  heartbeat cadence. Vercel plan limits must support this frequency.
- `GET /jobs/drain?limit=10` can be used for cron-style local probes with the
  same defaults as the Vercel cron path.
- `POST /jobs/drain` remains available for manual or test drains with a JSON
  body, for example `{ "limit": 5, "kinds": ["broker_sync"] }`.
