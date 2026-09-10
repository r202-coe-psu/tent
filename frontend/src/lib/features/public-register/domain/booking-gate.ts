/**
 * Public booking capacity gate + duplicate-hold checks (CR-112).
 *
 * Pure: no I/O. Forecast allow-list kept local so this module stays free of
 * cross-feature domain imports (lint: barrel-only).
 */

/** Stay statuses that still hold a Forecast seat (non-cancelled holds). */
export const ACTIVE_HOLD_STATUSES = [
	'pre_registered',
	'arriving',
	'active',
	'room_confirmed',
	'temporary_leave'
] as const;

export type BookingHoldIdentity = {
	phone?: string | null;
	/** National ID, passport, Anonymous ID (`ANON-…`), etc. */
	cardNumber?: string | null;
};

export type ExistingHoldCandidate = {
	current_stay?: { status?: string | null } | null;
	phone?: string | null;
	person_id?: { number?: string | null } | null;
};

function normalizeDigits(value: string | null | undefined): string {
	return (value ?? '').replace(/\D/g, '');
}

function normalizeCard(value: string | null | undefined): string {
	return (value ?? '').trim().toUpperCase();
}

/**
 * True when Forecast + party would exceed known capacity.
 * `capacity <= 0` means “no capacity data” — do not hard-block (same spirit as health %).
 */
export function isForecastCapacityExceeded(
	forecast: number,
	capacity: number,
	partySize: number
): boolean {
	if (!(capacity > 0) || !(partySize > 0)) return false;
	if (!(forecast >= 0) || !Number.isFinite(forecast)) return false;
	return forecast + partySize > capacity;
}

/** Whether an existing Evacuee still holds a Forecast seat. */
export function isActiveHoldStatus(status: string | null | undefined): boolean {
	return (ACTIVE_HOLD_STATUSES as readonly string[]).includes(status ?? '');
}

/**
 * True when an existing non-cancelled hold shares the booking contact phone
 * or card / Anonymous ID number.
 */
export function holdConflictsWithBooking(
	existing: ExistingHoldCandidate,
	booking: BookingHoldIdentity
): boolean {
	if (!isActiveHoldStatus(existing.current_stay?.status)) return false;

	const bookingPhone = normalizeDigits(booking.phone);
	const bookingCard = normalizeCard(booking.cardNumber);
	const existingPhone = normalizeDigits(existing.phone);
	const existingCard = normalizeCard(existing.person_id?.number);

	if (bookingPhone && existingPhone && bookingPhone === existingPhone) return true;
	if (bookingCard && existingCard && bookingCard === existingCard) return true;
	return false;
}

export function findDuplicateHold(
	existingHolds: readonly ExistingHoldCandidate[],
	booking: BookingHoldIdentity
): ExistingHoldCandidate | undefined {
	return existingHolds.find((hold) => holdConflictsWithBooking(hold, booking));
}
