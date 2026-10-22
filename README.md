# booking-crossfit

Auto-books recurring **CrossFit Roskilde** classes through the gym's BookingBoard API.

Anyone with a BookingBoard login for the gym can sign in to the web app, pick the classes they want every week, and get a push notification when something is booked. The app is an installable PWA, so there's no App Store app.

## How it works

- **Hold:** pick any number of recurring classes (class, weekday, time) from the gym's timetable, e.g. WOD Tue+Thu 17:30 plus another class on Fridays.
- Every evening at **19:00 (Copenhagen)** the worker books each user's next matching classes, earliest first, until they hold **5 bookings** (the gym's concurrent-booking cap).
  - Users are processed one at a time, in random order, with random gaps.
  - Cached tokens are reused.
  - Network and 5xx failures are retried once.
- **Kommende:** booked, waiting-list and planned classes.
  - **Spring over** skips a single class. If it's already booked, the booking is cancelled, and the spot goes to the next matching class.
  - Cancelled classes can be **booked again once**.
- **Kør min booking nu** queues an immediate run (at most one per 10 minutes).
- Classes you cancel yourself in the BookingBoard app are respected and never rebooked automatically.
- **Notifications** (Web Push) are sent for:
  - newly booked classes
  - a rejected login (once)
  - the first failure in a row
- On iPhone, push requires adding the app to the Home Screen (iOS 16.4+).

Passwords and tokens are stored encrypted (AES-256-GCM) so the worker can log in for each user. Deleting an account removes them.

## Layout

| Path | What |
|---|---|
| `packages/core` | BookingBoard API client and booking logic (`@booking/core`), with unit tests |
| `apps/web` | TanStack Start + Mantine app, SQLite (Drizzle), and the worker (`src/worker`) |
| `script.ts` | The original single-user CLI, kept until the app takes over |

## Requirements

- Node 25. It runs TypeScript directly. Pinned via Volta.
- pnpm.

## Development

```sh
pnpm install
cp apps/web/.env.example apps/web/.env    # then fill in the values
pnpm --filter @booking/web dev            # http://localhost:3000
pnpm --filter @booking/web worker         # the scheduler + run queue
pnpm test                                 # core unit tests
```

Worker flags for testing:
- `DRY_RUN=1` logs without booking.
- `--daily-now` runs the daily job at startup.
- `--no-jitter` skips the random delays.

After changing `apps/web/src/db/schema.ts`, run `pnpm --filter @booking/web db:generate`. Migrations are applied automatically on startup.

## Configuration (`apps/web/.env`)

| Var | Purpose |
|---|---|
| `APP_ENCRYPTION_KEY` | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts stored logins. Changing it means everyone logs in again. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push keys (`node -e "console.log(require('web-push').generateVAPIDKeys())"`) and a `mailto:` contact |
| `DATA_DIR` | Where `app.db` lives. Forced to `/data` in Docker. |
| `API_BASE_URL` / `CHAIN_ID` | BookingBoard host and chain (default: CrossFit Roskilde, 291) |
| `DRY_RUN` | `1` makes the worker compute and log without booking |

## Deploy

```sh
docker compose up -d --build
```

This runs two services from one image: `web` on port 3000 and `worker`, sharing a SQLite database on the `data` volume. They read `apps/web/.env`; set `ENV_FILE` to use another file.

Put `web` behind an HTTPS reverse proxy. Service workers, Web Push and the `Secure` session cookie all need HTTPS.

Back up the `data` volume and keep `APP_ENCRYPTION_KEY` somewhere other than the backups.

## Legacy CLI

Until the cutover, `script.ts` still books for one account from the root `.env`:
- `pnpm start` books.
- `DRY_RUN=1 pnpm start` only logs.

It reads the old env vars: `API_EMAIL`, `API_PASSWORD`, `CLASS_TITLE`, `TARGET_WEEKDAYS`, `TARGET_TIME`, `MAX_SESSIONS_PER_WEEK`, `MAX_TOTAL_SESSIONS`, `TRACKED_PEOPLE`, and Pushover.

Its one-time rebookings live in `booking-requests.json`, with state in `rebook-state.json`. To find participant ids for `TRACKED_PEOPLE`, run `node --env-file=.env scripts/find-participants.ts <classId>`.

## Notes

The endpoints were reverse-engineered from the BookingBoard app (auth, classes, bookings, participations). The BookingBoard app still handles calendars and reminders; this only books and notifies.
