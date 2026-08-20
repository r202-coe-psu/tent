import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

import {
	bookingCodeFrom,
	publicBookingInputSchema,
	toEvacueeInput
} from '$lib/features/public-register/server';
import { createEvacuee } from '$lib/features/people/server';
import { isShelterBookable } from '$lib/features/shelters/server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { registerIpLimiter, registerPhoneLimiter } from '$lib/server/security/rate-limiter';
import { shelterDbName } from '$lib/server/shelter-access-design';

// Never prerendered — runs on the Node server at runtime.
export const prerender = false;

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

/**
 * POST /api/public/v1/registrations — public shelter booking (CR-070 / T-71).
 *
 * Anonymous write path. The browser never holds a credential: this handler
 * validates, then writes the `evacuee` doc with the roleless public writer
 * (`putAsPublicWriter`), whose writes still pass through the shelter's
 * `_design/access` validate_doc_update. Stays entirely on CouchDB — the read
 * plane (Mongo/FastAPI) is not on the booking path, so a lagging projection
 * cannot block or mis-authorize a booking.
 *
 * The evacuee is minted `pre_registered` by `createEvacuee`, which is what makes
 * occupancy move immediately (D-BOOK-OCC=C) and lets the gate scan check them in
 * with no new code (`CHECK_IN_ELIGIBLE_STATUSES`).
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const payload = await request.json().catch(() => null);

	// 1. Shape. Client-supplied `_id`, `_rev`, `current_stay` and `registered_via`
	//    are not in the schema and are dropped here, never forwarded to CouchDB.
	const parsed = publicBookingInputSchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	const input = parsed.data;

	// 2. Rate limit on both axes before doing any work.
	const ip = getClientAddress();
	if (!registerIpLimiter.check(ip) || !registerPhoneLimiter.check(input.phone)) {
		return json(
			{ success: false, error: 'RATE_LIMITED' },
			{ status: 429, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	// 3. CAPTCHA — enforced in dev too so local testing matches production.
	if (!env.SECRET_RECAPTCHA_KEY || env.SECRET_RECAPTCHA_KEY === 'dummy-secret') {
		console.error('SECRET_RECAPTCHA_KEY is missing or invalid!');
		return json(
			{ success: false, error: 'SERVER_MISCONFIGURED' },
			{ status: 500, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	if (!input.captchaToken) {
		return json(
			{ success: false, error: 'CAPTCHA_REQUIRED' },
			{ status: 400, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	if (!(await captchaProvider.verifyToken(input.captchaToken, ip, 'register'))) {
		return json(
			{ success: false, error: 'CAPTCHA_FAILED' },
			{ status: 403, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	// 4. Trust nothing from the browser about the shelter. Resolved through
	//    `registry/_design/app/_view/by_code`, not a full-registry scan.
	const master = await findMasterByCode(input.shelter_code);
	if (!master) {
		return json(
			{ success: false, error: 'SHELTER_NOT_FOUND' },
			{ status: 404, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	if (!isShelterBookable(master)) {
		return json(
			{ success: false, error: 'SHELTER_CLOSED' },
			{ status: 409, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	// 5. Mint through the same domain factory staff registration uses, so a web
	//    booking and a counter registration produce an identical doc shape.
	const evacuee = createEvacuee(toEvacueeInput(input), {
		shelterCode: input.shelter_code,
		createdBy: 'public'
	});

	const res = await putAsPublicWriter(shelterDbName(input.shelter_code), evacuee._id, evacuee);
	if (res.status !== 201 && res.status !== 202) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		console.error(
			`public booking write failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
		return json(
			{ success: false, error: 'WRITE_FAILED' },
			{ status: 502, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	// 6. Ticket payload — no person_id, no medical, no full phone (Public DoD).
	return json(
		{
			success: true,
			code: bookingCodeFrom(evacuee._id),
			shelter_code: input.shelter_code,
			shelter_name: master.name,
			first_name: evacuee.first_name,
			status: evacuee.current_stay.status,
			booked_at: evacuee.created_at
		},
		{ status: 201, headers: { 'Cache-Control': 'no-store' } }
	);
};
