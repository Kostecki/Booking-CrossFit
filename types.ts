export type BookingRequestParams = {
  resourceId: number;
  sessionStartMs: number;
  durationSeconds?: number;
};

export type GetSessionBookingsParams = {
  resourceId: number;
  sessionStartMs: number;
  username: string;
  password: string;
  durationSeconds?: number;
};

export type BookSessionParams = {
  resourceId: number;
  sessionStartMs: number;
  username: string;
  password: string;
};

export type PushoverParams = {
  token: string;
  user: string;
  message: string;
  title?: string;
};

export type RawUserBooking = {
  Name: string;
  PersonRessourceId: number;
  RessourceId: number;
  StartDateTime: DotNetDateString;
  Duration: number;
  Capacity: number;
  NumberOnList: number;
  CenterName: string;
  CenterId: number;
  CancelBookingBefore: number;
  CanBookingBeCancelled: boolean;
  HasEnded: boolean;
  ShowOtherBookingsToMembers: number;
  Description: string;
};

export type GetBookingsParams = {
  username: string;
  password: string;
  callback?: string;
};

export type GetEventsForDayParams = {
  centerId: number;
  dayTimestampMs: number;
  username: string;
  password: string;
  callback?: string;
};

export type DotNetDateString = string;

export type RawBooking = {
  NumberOnBookingList: number;
  FullName: string;
  FirstName: string;
  LastName: string;
  UserName: string;
  ContactId: number;
  PersonRessourceId: number;
  ShowedUp: boolean;
  ContactType: number;
  BookingTime: DotNetDateString;
  ImageFileName: string | null;
};

export type JsonpPayload = {
  d?: RawBooking[];
};

export type JsonpEventsPayload = {
  d?: Record<string, unknown>[];
};

export type NormalizedBooking = {
  numberOnBookingList: number;
  fullName: string;
  firstName: string;
  lastName: string;
  userName: string;
  contactId: number;
  personResourceId: number;
  showedUp: boolean;
  contactType: number;
  bookingTimeMs: number | null;
  bookingTimeIso: string | null;
  imageFileName: string | null;
  raw: RawBooking;
};
