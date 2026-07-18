/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeReferral, resolveShelterCode, handleEndpointError } from './_auth';
import { CouchDbReferralServerRepository } from '$lib/features/referrals/server/referral.server-repository';
import {
	referralInputSchema,
	type ReferralStatus
} from '$lib/features/referrals/domain/referral.schema';

export const prerender = false;

/**
 * GET /api/back-office/referral
 * List referrals for a shelter (filter by status or evacuee_id)
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeReferral(request.headers.get('cookie'));

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const status = (url.searchParams.get('status') as ReferralStatus) || undefined;
		const evacueeId = url.searchParams.get('evacuee_id') || undefined;

		const repo = new CouchDbReferralServerRepository(`shelter_${shelterCode.toLowerCase()}`);
		const list = await repo.list({ status, evacuee_id: evacueeId });

		return json(list);
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API GET');
	}
};

/**
 * POST /api/back-office/referral
 * Create a new draft referral
 */
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const cookie = request.headers.get('cookie');
		if (!cookie) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		let caller;
		try {
			caller = await authorizeReferral(cookie);
		} catch (authErr: unknown) {
			const err = authErr as { status?: number; body?: { message?: string }; message?: string };
			const status = err.status || 401;
			const message = err.body?.message || err.message || 'Unauthorized';
			return json({ error: message }, { status });
		}

		if (!caller) {
			return json({ error: 'Unauthorized: Session missing' }, { status: 401 });
		}
		if (!caller.name) {
			return json({ error: 'Forbidden: Missing user details' }, { status: 403 });
		}

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const body = await request.json().catch(() => ({}));
		const parsed = referralInputSchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
		}

		const repo = new CouchDbReferralServerRepository(`shelter_${shelterCode.toLowerCase()}`);
		const ctx = {
			shelterCode,
			createdBy: caller.name
		};

		let created;
		try {
			created = await repo.create(parsed.data, ctx);
		} catch (dbError: unknown) {
			console.error('Failed to create referral in CouchDB:', dbError);
			return json({ error: 'Failed to create referral' }, { status: 500 });
		}

		return json(created, { status: 201 });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API POST');
	}
};
