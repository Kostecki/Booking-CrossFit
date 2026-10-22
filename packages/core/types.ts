// BookingBoard mobile REST API types.
// Base: https://crossfitroskilde.mobile.api.bookingboard.io

export type Credentials = {
	email: string;
	password: string;
	chainId: number;
};

export type Account = {
	id: number; // this is the accountId used by bookings/participations
	fullName: string;
	email: string;
	firstName?: string;
	lastName?: string;
	profileImageUrl?: string; // public CDN image
};

export type Instructor = {
	id: number;
	name: string;
};

// A class occurrence as returned by GET /api/Classes
export type ClazzMobile = {
	id: number; // the classHourId used when booking
	title: string;
	type?: string;
	subtitle?: string;
	begins: string; // ISO-8601 with timezone offset
	ends: string;
	instructors?: Instructor[];
	numberOfParticipants?: number;
	maximumNumberOfParticipants?: number;
	numberOfParticipantsOnWaitingList?: number;
	hasSeatsLeft?: boolean;
};

export type Participant = {
	id: number;
	participantId: number;
	participantName: string;
	status: ParticipationStatus;
};

// GET /api/Classes/{classId} — ClazzMobile plus the attendee list
export type ClazzDetail = ClazzMobile & {
	participants?: Participant[];
};

export type ParticipationStatus =
	| "SignedUp"
	| "OptedOut"
	| "OptedOutTooLate"
	| "OnTime"
	| "NeverMet"
	| (string & {});

// An entry from GET /api/accounts/{accountId}/bookings
export type ClassRegistration = {
	id: number; // participationId
	classId: number;
	className: string;
	begins: string; // ISO-8601
	ends?: string;
	status: ParticipationStatus;
	participantId?: number;
	participantName?: string;
};

// Request body for POST /api/Participations and PUT /api/Participations/{id}
export type ParticipateDto = {
	id: number;
	classHourId: number;
	accountId: number;
	status: ParticipationStatus;
};

export type PushoverParams = {
	token: string;
	user: string;
	message: string;
	title?: string;
};
