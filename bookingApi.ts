import type {
	Account,
	ClassRegistration,
	ClazzDetail,
	ClazzMobile,
	Credentials,
	ParticipateDto,
	PushoverParams,
} from "./types.ts";

const BASE_URL =
	process.env.API_BASE_URL ??
	"https://crossfitroskilde.mobile.api.bookingboard.io";

type ApiFetchOptions = {
	method?: string;
	token?: string;
	body?: unknown;
	query?: Record<string, string>;
};

async function apiFetch<T>(
	path: string,
	{ method = "GET", token, body, query }: ApiFetchOptions = {},
): Promise<T> {
	const url = new URL(path, BASE_URL);
	if (query) {
		url.search = new URLSearchParams(query).toString();
	}

	const headers: Record<string, string> = { Accept: "application/json" };
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const response = await fetch(url, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`${method} ${path} failed: ${response.status} ${response.statusText} - ${text}`,
		);
	}

	const text = await response.text();
	return (text ? JSON.parse(text) : null) as T;
}

/** Format a Date as the API's `start` query param: YYYY-MM-DDTHH:MM:SS. */
export function toApiDateTime(
	year: number,
	month: number,
	day: number,
	hour = 0,
	minute = 0,
	second = 0,
): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export async function login({
	email,
	password,
	chainId,
}: Credentials): Promise<string> {
	const data = await apiFetch<{ token: string }>("/api/authentication", {
		method: "POST",
		body: { email, password, chainId },
	});
	if (!data?.token) {
		throw new Error("Login succeeded but no token was returned");
	}
	return data.token;
}

export async function getAccount(token: string): Promise<Account> {
	return apiFetch<Account>("/api/accounts", { token });
}

/** All classes from `startIso` forward (the server returns a ~4-week window). */
export async function getClasses(
	token: string,
	startIso: string,
): Promise<ClazzMobile[]> {
	return apiFetch<ClazzMobile[]>("/api/Classes", {
		token,
		query: { start: startIso },
	});
}

/** The caller's own bookings (past + future), scoped by the token. */
export async function getMyBookings(
	token: string,
	accountId: number,
): Promise<ClassRegistration[]> {
	return apiFetch<ClassRegistration[]>(`/api/accounts/${accountId}/bookings`, {
		token,
	});
}

/** A single class including its attendee (`participants`) list. */
export async function getClassDetail(
	token: string,
	classId: number,
): Promise<ClazzDetail> {
	return apiFetch<ClazzDetail>(`/api/Classes/${classId}`, { token });
}

export async function bookClass(
	token: string,
	{ classHourId, accountId }: { classHourId: number; accountId: number },
): Promise<ClassRegistration> {
	const body: ParticipateDto = {
		id: 0,
		classHourId,
		accountId,
		status: "SignedUp",
	};
	return apiFetch<ClassRegistration>("/api/Participations", {
		method: "POST",
		token,
		body,
	});
}

/** Cancel (opt out of) a booking. Not used by the automation; kept for parity. */
export async function cancelBooking(
	token: string,
	{
		participationId,
		classHourId,
		accountId,
	}: { participationId: number; classHourId: number; accountId: number },
): Promise<ClassRegistration> {
	const body: ParticipateDto = {
		id: participationId,
		classHourId,
		accountId,
		status: "OptedOut",
	};
	return apiFetch<ClassRegistration>(
		`/api/Participations/${participationId}`,
		{ method: "PUT", token, body },
	);
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
