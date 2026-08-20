import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import {
	bookingCodeFrom,
	evacueeIdFromBookingCode,
	publicBookingLookupSchema
} from '$lib/features/public-register/server';
import { findMasterByCode, listShelterMasters } from '$lib/server/shelters.admin';
import { adminRaw } from '$lib/server/couch-admin';
import { registerLookupIpLimiter } from '$lib/server/security/rate-limiter';
import { shelterDbName } from '$lib/server/shelter-access-design';

export const prerender = false;

/**
 * Uniform failure — never reveal whether the code exists but the phone is wrong.
 *
 * Built fresh per call: a `Response` body can only be read once, so sharing a
 * single instance across requests hands the second caller an unusable body.
 */
const notFound = () =>
	json(
		{ success: false, error: 'BOOKING_NOT_FOUND' },
		{ status: 404, headers: { 'Cache-Control': 'no-store' } }
	);

interface EvacueeDoc {
	type?: string;
	first_name?: string;
	phone?: string | null;
	shelter_code?: string;
	created_at?: string;
	registered_via?: string;
	current_stay?: { status?: string };
}

/**
 * POST /api/public/v1/registrations/lookup — self-service booking status.
 *
 * D-BOOK-TOKEN=A: booking code + phone, the same two-factor shape as donation
 * `track-search`. The code is the evacuee ULID (see `bookingCodeFrom`), which
 * does not say which shelter it belongs to, so this walks the shelter databases
 * until it hits one. Small N (registry holds a handful of shelters) and the
 * per-IP limiter keeps it from becoming an enumeration oracle; when
 * `official_code` (T-50) lands it will carry a shelter prefix and this becomes a
 * single targeted read.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const payload = await request.json().catch(() => null);

	const parsed = publicBookingLookupSchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	if (!registerLookupIpLimiter.check(getClientAddress())) {
		return json(
			{ success: false, error: 'RATE_LIMITED' },
			{ status: 429, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	const docId = evacueeIdFromBookingCode(parsed.data.code);
	const masters = await listShelterMasters();

	for (const master of masters) {
		const res = await adminRaw(
			`/${shelterDbName(master.code)}/${encodeURIComponent(docId)}`,
			'GET'
		);
		if (res.status !== 200) continue;

		const doc = res.data as EvacueeDoc | null;
		if (!doc || doc.type !== 'evacuee') continue;
		// Phone is the second factor — a bare code must never resolve.
		if (!doc.phone || doc.phone !== parsed.data.phone) return notFound();
		// Only web bookings are self-serviceable; staff-registered people are not
		// lookup-able by the public even if someone guesses their id.
		if (doc.registered_via !== 'web') return notFound();

		const shelter = await findMasterByCode(doc.shelter_code ?? master.code);

		return json(
			{
				success: true,
				code: bookingCodeFrom(docId),
				shelter_code: doc.shelter_code ?? master.code,
				shelter_name: shelter?.name ?? master.code,
				first_name: doc.first_name ?? '',
				status: doc.current_stay?.status ?? 'unknown',
				booked_at: doc.created_at ?? null
			},
			{ status: 200, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	return notFound();
};
