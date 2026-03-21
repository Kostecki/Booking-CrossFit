import {
  bookSession,
  getBookings,
  getEventsForDay,
  getSessionBookings,
  sendPushoverNotification,
} from "./bookingApi.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const username = requireEnv("API_USERNAME");
const password = requireEnv("API_PASSWORD");
const PUSHOVER_TOKEN = requireEnv("PUSHOVER_TOKEN");
const PUSHOVER_USER = requireEnv("PUSHOVER_USER");

const centerId = Number(requireEnv("CENTER_ID"));
const centerTimeZone = "Europe/Copenhagen";
const people: Record<string, string> = JSON.parse(
  process.env.TRACKED_PEOPLE ?? "{}",
);

const TARGET_WEEKDAYS = [2, 4]; // 2=Tuesday, 4=Thursday (0=Sunday … 6=Saturday)
const TARGET_BOOKING_COUNT = 4;
const MAX_SCAN_DAYS = 60; // safety limit when scanning forward
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type EventItem = {
  RessourceId: number;
  StartDateTime: string;
  Title?: string;
  Name?: string;
  Text?: string;
  Capacity?: number;
  FreeSpace?: number;
};

function parseDotNetDate(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^\/Date\((-?\d+)\)\/$/);
  if (!match) {
    return null;
  }

  const ms = Number(match[1]);
  return Number.isFinite(ms) ? ms : null;
}

function isEventItem(value: unknown): value is EventItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EventItem>;
  return (
    typeof candidate.RessourceId === "number" &&
    typeof candidate.StartDateTime === "string"
  );
}

function getTimePartsInZone(
  timestampMs: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date(timestampMs));
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value;

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
  };
}

function isSameDayInZone(
  timestampMs: number,
  referenceMs: number,
  timeZone: string,
): boolean {
  const valueDay = getTimePartsInZone(timestampMs, timeZone);
  const refDay = getTimePartsInZone(referenceMs, timeZone);

  return (
    valueDay.year === refDay.year &&
    valueDay.month === refDay.month &&
    valueDay.day === refDay.day
  );
}

function isTargetTimeInZone(
  timestampMs: number,
  targetHour: number,
  targetMinute: number,
  timeZone: string,
): boolean {
  const valueTime = getTimePartsInZone(timestampMs, timeZone);
  return valueTime.hour === targetHour && valueTime.minute === targetMinute;
}

function isWodEvent(event: EventItem): boolean {
  const normalizedName = event.Name?.trim().toUpperCase();
  const normalizedText = event.Text?.trim().toUpperCase();
  const normalizedTitle = event.Title?.trim().toUpperCase();

  return (
    normalizedName === "WOD" ||
    normalizedText === "WOD" ||
    normalizedTitle?.startsWith("WOD ") === true
  );
}

async function fetchEventsForDay(centerId: number, dayTimestampMs: number) {
  return getEventsForDay({
    centerId,
    dayTimestampMs,
    username,
    password,
  });
}

async function main() {
  const nowMs = Date.now();
  const runDate = new Date(nowMs).toLocaleDateString("en-GB", {
    timeZone: centerTimeZone,
  });
  console.log(`Today: ${runDate}\n`);

  const existingBookings = await getBookings({ username, password });
  const futureBookings = existingBookings
    .map((b) => ({
      ms: parseDotNetDate(b.StartDateTime),
      name: b.Name,
      capacity: b.Capacity,
      numberOnList: b.NumberOnList,
    }))
    .filter(
      (
        b,
      ): b is {
        ms: number;
        name: string;
        capacity: number;
        numberOnList: number;
      } => b.ms !== null && b.ms > nowMs,
    )
    .sort((a, b) => a.ms - b.ms);
  const futureBookedTimes = new Set(futureBookings.map((b) => b.ms));

  const bookedDateLabels = futureBookings.map((b) => {
    const date = new Date(b.ms).toLocaleDateString("en-GB", {
      timeZone: centerTimeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const occupancy = `(${b.numberOnList}/${b.capacity})`;
    return `${date} ${occupancy}`;
  });
  console.log(
    `Currently booked: ${futureBookedTimes.size}/${TARGET_BOOKING_COUNT}${
      bookedDateLabels.length > 0 ? `\n${bookedDateLabels.join("\n")}` : ""
    }\n`,
  );

  const newlyBooked: string[] = [];
  let totalBookings = futureBookedTimes.size;

  for (
    let i = 0;
    i < MAX_SCAN_DAYS && totalBookings < TARGET_BOOKING_COUNT;
    i++
  ) {
    const candidateMs = nowMs + i * ONE_DAY_MS;
    const { year, month, day } = getTimePartsInZone(
      candidateMs,
      centerTimeZone,
    );
    const weekday = new Date(year, month - 1, day).getDay();

    if (!TARGET_WEEKDAYS.includes(weekday)) {
      continue;
    }

    const allEvents = await fetchEventsForDay(centerId, candidateMs);
    const dayEvents = allEvents.filter(isEventItem).filter((event) => {
      const ms = parseDotNetDate(event.StartDateTime);

      return ms !== null && isSameDayInZone(ms, candidateMs, centerTimeZone);
    });

    const targetEvent = dayEvents.find((event) => {
      const ms = parseDotNetDate(event.StartDateTime);

      return (
        ms !== null &&
        isTargetTimeInZone(ms, 17, 30, centerTimeZone) &&
        isWodEvent(event)
      );
    });

    if (!targetEvent) {
      continue;
    }

    const sessionStartMs = parseDotNetDate(targetEvent.StartDateTime);
    if (sessionStartMs === null) {
      continue;
    }

    const dateLabel = new Date(sessionStartMs).toLocaleDateString("en-GB", {
      timeZone: centerTimeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const dateLabelDa = new Date(sessionStartMs).toLocaleDateString("da-DK", {
      timeZone: centerTimeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const bookedCount =
      targetEvent.Capacity !== undefined && targetEvent.FreeSpace !== undefined
        ? targetEvent.Capacity - targetEvent.FreeSpace
        : null;
    const bookedCountLabel =
      bookedCount !== null && targetEvent.Capacity !== undefined
        ? ` (${bookedCount}/${targetEvent.Capacity} booked)`
        : "";
    const sessionLabel = `WOD 17:30 on ${dateLabel}${bookedCountLabel}`;

    if (futureBookedTimes.has(sessionStartMs)) {
      totalBookings++;
      console.log(`Already booked: ${sessionLabel}`);
      continue;
    }

    console.log(`Booking: ${sessionLabel}`);
    await bookSession({
      resourceId: targetEvent.RessourceId,
      sessionStartMs,
      username,
      password,
    });

    const updatedBookings = await getBookings({ username, password });
    const verified = updatedBookings.some(
      (b) => parseDotNetDate(b.StartDateTime) === sessionStartMs,
    );

    if (!verified) {
      throw new Error(`Booking verification failed for ${sessionLabel}`);
    }

    const allParticipants = await getSessionBookings({
      resourceId: targetEvent.RessourceId,
      sessionStartMs,
      username,
      password,
    });

    // Recalculate occupancy based on actual participants (includes newly-booked user)
    const updatedBookedCount = allParticipants.length;
    const updatedBookedCountLabel =
      targetEvent.Capacity !== undefined
        ? ` (${updatedBookedCount}/${targetEvent.Capacity})`
        : "";

    // Check if this booking is on a waiting list
    const bookedSession = updatedBookings.find(
      (b) => parseDotNetDate(b.StartDateTime) === sessionStartMs,
    );
    const isWaitingList =
      bookedSession?.Capacity &&
      bookedSession.NumberOnList > bookedSession.Capacity;

    const trackedPeopleHere = allParticipants
      .filter((booking) => people[booking.userName])
      .map((booking) => people[booking.userName])
      .sort();

    // English console label
    const consoleLabel = `WOD 17:30 on ${dateLabel}${updatedBookedCountLabel}${isWaitingList ? " (WAITING LIST)" : ""}`;
    const consoleTracked =
      trackedPeopleHere.length > 0
        ? ` - also attending: ${trackedPeopleHere.join(", ")}`
        : "";

    // Danish Pushover label
    const pushoverLabel = `WOD 17:30 d. ${dateLabelDa}${updatedBookedCountLabel}${isWaitingList ? " (VENTELISTE)" : ""}`;
    const pushoverTracked =
      trackedPeopleHere.length > 0
        ? `\n  Deltager også: ${trackedPeopleHere.join(", ")}`
        : "";

    totalBookings++;
    console.log(`Booked and verified: ${consoleLabel}${consoleTracked}`);
    newlyBooked.push(pushoverLabel + pushoverTracked);
  }

  if (newlyBooked.length > 0) {
    const trainingWord = newlyBooked.length === 1 ? "træning" : "træninger";

    await sendPushoverNotification({
      token: PUSHOVER_TOKEN,
      user: PUSHOVER_USER,
      title: "CrossFit Bookinger",
      message: `Booket ${newlyBooked.length} ${trainingWord}:\n${newlyBooked.join("\n")}`,
    });
  }
}

main().catch(async (error) => {
  console.error(error);

  await sendPushoverNotification({
    token: PUSHOVER_TOKEN,
    user: PUSHOVER_USER,
    title: "CrossFit booking fejl",
    message: `Fejl: ${String(error)}`,
  }).catch(() => {});
});
