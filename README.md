# booking-crossfit

Auto-books my recurring **CrossFit Roskilde** classes through the gym's BookingBoard API, and pushes a notification when something is booked.

It's a one-shot script meant to run on a schedule (e.g. cron): each run logs in, looks at what I'm already booked into, and books the next sessions needed to hit the target.

## What it does

- Books the **WOD at 17:30 on Tuesdays and Thursdays**.
- Keeps **up to 5 upcoming bookings** (the gym's concurrent-booking cap), max **2 per week**.
- Counts my existing bookings (incl. earlier this week) from the API, so it never double-books or exceeds the caps.
- Sends a **Pushover** summary of anything newly booked, and notes which tracked friends are also attending.

## Requirements

- Node 25 (runs TypeScript directly — no build step). Pinned via Volta.
- Package manager: pnpm. No runtime dependencies.

## Setup

```sh
cp .env.example .env   # then fill in the values
pnpm install           # dev types only
```

## Run

```sh
pnpm start                      # book + notify
DRY_RUN=1 pnpm start            # log what it would book, without booking
```

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `API_BASE_URL` | BookingBoard REST host |
| `API_EMAIL` / `API_PASSWORD` | Gym login |
| `CHAIN_ID` | Gym chain id (291 for CrossFit Roskilde) |
| `TRACKED_PEOPLE` | `{"participantId":"Name"}` map for "also attending" |
| `DRY_RUN` | `1` to compute + log without booking |
| `PUSHOVER_TOKEN` / `PUSHOVER_USER` | Notifications |

The booking policy (weekdays, target time, caps) lives as constants at the top of
`script.ts`.

### Finding participant ids

To populate `TRACKED_PEOPLE`, list a class's attendees and copy the ids you want:

```sh
node --env-file=.env scripts/find-participants.ts <classId>
```

## Notes

The gym runs on BookingBoard; the endpoints this uses were reverse-engineered from the app (auth, classes, bookings, participations). The calendar/reminders are handled by the BookingBoard app itself, so this script only books and notifies.
