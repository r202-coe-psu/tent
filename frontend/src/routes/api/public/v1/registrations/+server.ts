import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

import {
	bookingCodeFrom,
	isCaptchaKeyConfigured,
	publicBookingInputSchema,
	toEvacueeInputs,
	toHouseholdInput
} from '$lib/features/public-register/server';
import { createEvacuee, createHousehold } from '$lib/features/people/server';
import { isShelterBookable } from '$lib/features/shelters/server';
import { bulkAsPublicWriter, rollbackAsPublicWriter } from '$lib/server/couch-public-writer';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { registerIpLimiter, registerPhoneLimiter } from '$lib/server/security/rate-limiter';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { findMasterByCode } from '$lib/server/shelters.admin';

// Never prerendered — runs on the Node server at runtime.
export const prerender = false;

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

const noStore = { 'Cache-Control': 'no-store' };

/**
 * POST /api/public/v1/registrations — public shelter booking (CR-070 / T-71).
 *
 * Anonymous write path. The browser never holds a credential: this handler
 * validates, then writes with the roleless public writer, whose writes still
 * pass through the shelter's `_design/access` validate_doc_update. Stays
 * entirely on CouchDB — the read plane (Mongo/FastAPI) is not on the booking
 * path, so a lagging projection cannot block or mis-authorize a booking.
 *
 * One booking = one `household` + one `evacuee` per member (CR-076: nobody is
 * household-less, a solo booker is a one-person household). Every evacuee is
 * minted `pre_registered` by `createEvacuee`, which is what makes occupancy move
 * immediately (D-BOOK-OCC=C) and lets the gate scan check them in with no new
 * code (`CHECK_IN_ELIGIBLE_STATUSES`).
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const payload = await request.json().catch(() => null);

	// 1. Shape. Client-supplied `_id`, `_rev`, `current_stay` and `registered_via`
	//    are not in the schema and are dropped here, never forwarded to CouchDB.
	const parsed = publicBookingInputSchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}
	const input = parsed.data;

	// 2. Rate limit on both axes before doing any work.
	const ip = getClientAddress();
	if (!registerIpLimiter.check(ip) || !registerPhoneLimiter.check(input.phone)) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429, headers: noStore });
	}

	// 3. CAPTCHA. Required by the Public task DoD (CR-070), but a developer who has
	//    not been issued Google keys must still be able to run the flow. Fail OPEN
	//    only when `dev` AND no real key is configured; production always fails
	//    CLOSED, so a deploy that forgets the secret is rejected rather than
	//    silently unguarded.
	if (!isCaptchaKeyConfigured(env.SECRET_RECAPTCHA_KEY)) {
		if (!dev) {
			console.error('SECRET_RECAPTCHA_KEY is missing or is a placeholder!');
			return json(
				{ success: false, error: 'SERVER_MISCONFIGURED' },
				{ status: 500, headers: noStore }
			);
		}
		console.warn('[dev] SECRET_RECAPTCHA_KEY not configured — skipping CAPTCHA verification');
	} else {
		if (!input.captchaToken) {
			return json({ success: false, error: 'CAPTCHA_REQUIRED' }, { status: 400, headers: noStore });
		}
		if (!(await captchaProvider.verifyToken(input.captchaToken, ip, 'register'))) {
			return json({ success: false, error: 'CAPTCHA_FAILED' }, { status: 403, headers: noStore });
		}
	}

	// 4. Trust nothing from the browser about the shelter. Resolved through
	//    `registry/_design/app/_view/by_code`, not a full-registry scan.
	const master = await findMasterByCode(input.shelter_code);
	if (!master) {
		return json({ success: false, error: 'SHELTER_NOT_FOUND' }, { status: 404, headers: noStore });
	}
	if (!isShelterBookable(master)) {
		return json({ success: false, error: 'SHELTER_CLOSED' }, { status: 409, headers: noStore });
	}

	// 5. Mint through the same domain factories staff registration uses, so a web
	//    booking and a counter registration produce identical doc shapes. The
	//    factories mint their own ULIDs, so build the household first, point the
	//    members at it, then link the head back — all before anything is written.
	const ctx = { shelterCode: input.shelter_code, createdBy: 'public' };

	const household = createHousehold(toHouseholdInput(input, ''), ctx);
	const evacuees = toEvacueeInputs(input, household._id).map((memberInput) =>
		createEvacuee(memberInput, ctx)
	);
	household.head_evacuee_id = evacuees[0]._id;

	const dbName = shelterDbName(input.shelter_code);
	const { status, failed, written } = await bulkAsPublicWriter(dbName, [household, ...evacuees]);
	if (failed.length > 0) {
		console.error(
			`public booking write failed (${status}): ` +
				failed.map((f) => `${f.id}=${f.reason}`).join(', ')
		);

		// `_bulk_docs` is per-row, not a transaction: the rows that were accepted
		// are already durable. Left alone they become an orphan household — or an
		// evacuee holding a `pre_registered` place (and therefore occupancy, per
		// D-BOOK-OCC=C) for a booking the citizen was just told had failed.
		const { rolledBack, orphaned } = await rollbackAsPublicWriter(dbName, written);
		if (rolledBack.length > 0) {
			console.warn(`public booking rolled back partial write: ${rolledBack.join(', ')}`);
		}
		if (orphaned.length > 0) {
			console.error(
				`public booking LEFT ORPHAN DOCS in ${dbName} — needs manual cleanup: ${orphaned.join(', ')}`
			);
		}

		return json({ success: false, error: 'WRITE_FAILED' }, { status: 502, headers: noStore });
	}

	// 6. Ticket payload — no person_id, no medical, no full phone (Public DoD).
	//    The code is the contact's evacuee id: that is what the QR carries and what
	//    the gate scanner already resolves.
	return json(
		{
			success: true,
			code: bookingCodeFrom(evacuees[0]._id),
			shelter_code: input.shelter_code,
			shelter_name: master.name,
			first_name: evacuees[0].first_name,
			member_count: evacuees.length,
			pet_count: input.pets.length,
			status: evacuees[0].current_stay.status,
			booked_at: evacuees[0].created_at
		},
		{ status: 201, headers: noStore }
	);
};
