import type {
  BookingRequestParams,
  BookSessionParams,
  GetBookingsParams,
  GetEventsForDayParams,
  GetSessionBookingsParams,
  JsonpEventsPayload,
  JsonpPayload,
  NormalizedBooking,
  PushoverParams,
  RawBooking,
  RawUserBooking,
} from "./types.ts";

const SESSION_DURATION_SECONDS = 3600;

function ensureFiniteMs(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a specific timestamp in milliseconds`);
  }
}

function buildBookingUrl({
  resourceId,
  sessionStartMs,
  durationSeconds = SESSION_DURATION_SECONDS,
  username,
  password,
}: BookingRequestParams &
  Pick<GetSessionBookingsParams, "username" | "password">): string {
  ensureFiniteMs(sessionStartMs, "sessionStartMs");

  const url = new URL(
    "https://memberservicewebservice.sport-solution.com/bookingjson.asmx/GetListofPeopleBooked",
  );

  url.search = new URLSearchParams({
    callback: "angular.callbacks._g",
    Password: `'${password}'`,
    UserName: `'${username}'`,
    ressourceId: String(resourceId),
    duration: String(durationSeconds),
    timestamp: String(sessionStartMs),
  }).toString();

  return url.toString();
}

function parseJsonp(jsonpText: string): JsonpPayload {
  const trimmed = jsonpText.trim();
  const start = trimmed.indexOf("(");
  const end = trimmed.lastIndexOf(")");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Response is not valid JSONP");
  }

  const jsonText = trimmed.slice(start + 1, end);
  return JSON.parse(jsonText) as JsonpPayload;
}

function parseJsonpEvents(jsonpText: string): JsonpEventsPayload {
  const trimmed = jsonpText.trim();
  const start = trimmed.indexOf("(");
  const end = trimmed.lastIndexOf(")");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Response is not valid JSONP");
  }

  const jsonText = trimmed.slice(start + 1, end);
  return JSON.parse(jsonText) as JsonpEventsPayload;
}

function buildGetEventsUrl({
  centerId,
  dayTimestampMs,
  username,
  password,
  callback = "angular.callbacks._g",
}: GetEventsForDayParams): string {
  ensureFiniteMs(dayTimestampMs, "dayTimestampMs");

  const url = new URL(
    "https://memberservicewebservice.sport-solution.com/bookingjson.asmx/jGetEvents",
  );

  url.search = new URLSearchParams({
    callback,
    username: `'${username}'`,
    password: `'${password}'`,
    centerId: String(centerId),
    timestamp: String(dayTimestampMs),
  }).toString();

  return url.toString();
}

function parseDotNetDate(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^\/Date\((-?\d+)\)\/$/);
  if (!match) {
    return null;
  }

  const ms = Number(match[1]);
  if (!Number.isFinite(ms)) {
    return null;
  }

  return ms;
}

function normalizeBooking(booking: RawBooking): NormalizedBooking {
  const bookingTimeMs = parseDotNetDate(booking.BookingTime);

  return {
    numberOnBookingList: booking.NumberOnBookingList,
    fullName: booking.FullName,
    firstName: booking.FirstName,
    lastName: booking.LastName,
    userName: booking.UserName,
    contactId: booking.ContactId,
    personResourceId: booking.PersonRessourceId,
    showedUp: booking.ShowedUp,
    contactType: booking.ContactType,
    bookingTimeMs,
    bookingTimeIso: bookingTimeMs
      ? new Date(bookingTimeMs).toISOString()
      : null,
    imageFileName: booking.ImageFileName,
    raw: booking,
  };
}

export async function getSessionBookings({
  resourceId,
  sessionStartMs,
  username,
  password,
  durationSeconds = SESSION_DURATION_SECONDS,
}: GetSessionBookingsParams): Promise<NormalizedBooking[]> {
  const url = buildBookingUrl({
    resourceId,
    sessionStartMs,
    username,
    password,
    durationSeconds,
  });

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Request failed: ${response.status} ${response.statusText} - ${body}`,
    );
  }

  const body = await response.text();
  const parsed = parseJsonp(body);
  const bookings = Array.isArray(parsed?.d) ? parsed.d : [];

  return bookings.map(normalizeBooking);
}

export async function getBookings({
  username,
  password,
  callback = "angular.callbacks._q",
}: GetBookingsParams): Promise<RawUserBooking[]> {
  const url = new URL(
    "https://memberservicewebservice.sport-solution.com/bookingjson.asmx/GetBookings",
  );

  url.search = new URLSearchParams({
    callback,
    Password: `'${password}'`,
    UserName: `'${username}'`,
  }).toString();

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Request failed: ${response.status} ${response.statusText} - ${body}`,
    );
  }

  const body = await response.text();
  const parsed = parseJsonpEvents(body);
  return (Array.isArray(parsed?.d) ? parsed.d : []) as RawUserBooking[];
}

export async function getEventsForDay({
  centerId,
  dayTimestampMs,
  username,
  password,
  callback,
}: GetEventsForDayParams): Promise<Record<string, unknown>[]> {
  const url = buildGetEventsUrl({
    centerId,
    dayTimestampMs,
    username,
    password,
    callback,
  });

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Request failed: ${response.status} ${response.statusText} - ${body}`,
    );
  }

  const body = await response.text();
  const parsed = parseJsonpEvents(body);
  const events = Array.isArray(parsed?.d) ? parsed.d : [];

  return events;
}

function buildBookSessionUrl({
  resourceId,
  sessionStartMs,
  username,
  password,
  centerId = 653679,
}: BookSessionParams & {
  centerId?: number;
}): string {
  ensureFiniteMs(sessionStartMs, "sessionStartMs");

  const url = new URL(
    "https://memberservicewebservice.sport-solution.com/bookingjson.asmx/BookRessourceWithWarningsByContactBookingTypeAndBookingsCount",
  );

  url.search = new URLSearchParams({
    callback: "angular.callbacks._u",
    Password: `'${password}'`,
    UserName: `'${username}'`,
    bookingsCount: "1",
    centerid: String(centerId),
    contactBookingType: "3",
    duration: String(SESSION_DURATION_SECONDS),
    ressourceId: String(resourceId),
    timestamp: String(sessionStartMs),
  }).toString();

  return url.toString();
}

export async function bookSession(params: BookSessionParams): Promise<void> {
  const url = buildBookSessionUrl(params);

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Request failed: ${response.status} ${response.statusText} - ${body}`,
    );
  }

  const body = await response.text();
  const parsed = parseJsonp(body);

  // .NET API returns {"d": ""} or {"d": "success"} on successful booking
  // Any response with ok status is considered success
  if (typeof parsed?.d === "string") {
    return;
  }

  throw new Error(`BookSession returned unexpected response: ${body}`);
}

export async function sendPushoverNotification({
  token,
  user,
  message,
  title,
}: PushoverParams): Promise<void> {
  const response = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, user, message, title }),
  });

  if (!response.ok) {
    throw new Error(
      `Pushover notification failed: ${response.status} ${response.statusText}`,
    );
  }
}
