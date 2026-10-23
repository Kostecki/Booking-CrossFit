# Auto CFR

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

## Requirements

- Node 25. It runs TypeScript directly. Pinned via Volta.
- pnpm.

## Development

```sh
pnpm install
cp apps/web/.env.example apps/web/.env    # then fill in the values
pnpm dev                                  # web (http://localhost:3000) + worker
pnpm dev --host                           # same, reachable from your phone on the LAN
pnpm dev:https                            # same over HTTPS, for testing the PWA on a phone
pnpm test                                 # core unit tests
```

`pnpm dev` runs the worker as a dry run, so a local dev setup never books for real next to the production worker. Use `DRY_RUN= pnpm dev` for real runs, or `pnpm --filter @booking/web worker` to run only the worker.

### Testing the PWA on a phone

Service workers, installing the app and push only work over HTTPS with a certificate
the phone trusts. `pnpm dev:https` uses [mkcert](https://github.com/FiloSottile/mkcert)
(`brew install mkcert`) to issue a certificate for `localhost`, the Mac's LAN IP and its
Bonjour name (e.g. `JacobsMBP.local`), and prints the addresses to open as `Phone:`. Use the
IP: some networks don't resolve `.local` names for the phone even when the Mac is reachable.
The phone must be on the same network; a new IP just gets a new certificate on the next start.

One-time setup on the iPhone:
1. AirDrop `$(mkcert -CAROOT)/rootCA.pem` to the phone and install the profile
   (Settings → General → VPN & Device Management).
2. Turn on full trust for it: Settings → General → About → Certificate Trust Settings.

Optionally run `mkcert -install` to trust the same certificate in the Mac's browsers.

Worker flags for testing:
- `DRY_RUN=1` logs without booking.
- `--daily-now` runs the daily job at startup.
- `--no-jitter` skips the random delays.

After changing `apps/web/src/db/schema.ts`, run `pnpm --filter @booking/web db:generate`. Never write or edit migration SQL by hand.

Migrations are applied when the server or the worker starts. A dev server that was already running doesn't apply new ones, so run `pnpm --filter @booking/web db:migrate` (it uses `DATA_DIR` from `apps/web/.env`).

## Configuration (`apps/web/.env`)

| Var | Purpose |
|---|---|
| `APP_ENCRYPTION_KEY` | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts stored logins. Changing it means everyone logs in again. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push keys (`node -e "console.log(require('web-push').generateVAPIDKeys())"`) and a `mailto:` contact |
| `DATA_DIR` | Where `app.db` lives. Forced to `/data` in Docker. |
| `API_BASE_URL` / `CHAIN_ID` | BookingBoard host and chain (default: CrossFit Roskilde, 291) |
| `DRY_RUN` | `1` makes the worker compute and log without booking |

## Deploy

This is set up like the other homelab projects:
- CI (`.github/workflows/build-push-image.yml`) tests the code, builds amd64 + arm64 images on native runners, and publishes them to `ghcr.io/kostecki/booking-crossfit`.
- Pushes to main are tagged `:latest` and `:sha-<short>`, then deployed through Komodo (`Kostecki/shared-actions` deploy-komodo, over Tailscale).
- Pushes to other branches publish `:<branch>` and `:sha-<short>` without deploying.

The Komodo stack deploys `docker-compose.yml`. It runs `web` (port `${APP_PORT:-3000}`) and `worker` from the same image, sharing the SQLite database in `${DATA_DIR}/data`.

Setup:

1. Create the data folder on the server and give it to the image's `node` user: `sudo chown -R 1000:1000 <docker root>/projects/booking-crossfit/data`.
2. Create the Komodo stack from this repo with `docker-compose.yml`. In its Environment, set:
   - `DATA_DIR`
   - `APP_ENCRYPTION_KEY`
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   - optionally `APP_PORT`, `DRY_RUN=1`
3. Set the repo variables `TS_OAUTH_CLIENT_ID`, `TS_HOST`, `KOMODO_PORT`, `KOMODO_STACK_ID` and the secrets `KOMODO_API_KEY`, `KOMODO_API_SECRET`.
4. In Pangolin, add a resource for the web service. It must be HTTPS: service workers, Web Push and the `Secure` session cookie all need it. The app has its own login, so Pangolin auth isn't needed in front of it.

`nautical-backup` picks up both containers (group `booking-crossfit`). Keep `APP_ENCRYPTION_KEY` outside the backups.

Locally, `docker compose up --build` builds the image through `compose.override.yaml`. It reads variables from the root `.env`.

## Notes

The endpoints were reverse-engineered from the BookingBoard app (auth, classes, bookings, participations). The BookingBoard app still handles calendars and reminders; this only books and notifies.
