/* eslint-disable no-restricted-imports */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { isShelterManager } from '$lib/auth/roles';
import { ReferralRemoteRepository } from '$lib/features/referrals/data/referral.remote';
import {
	referralInputSchema,
	type ReferralStatus
} from '$lib/features/referrals/domain/referral.schema';

export const prerender = false;

// Helper to authorize a referral action (SM or SA only)
async function authorizeReferral(cookie: string | null) {
	const caller = await requireShelterScopeOrSA(cookie);
	const allowed = caller.isSA || isShelterManager(caller.roles);
	if (!allowed) {
		throw error(403, 'Requires shelter_manager or system_admin role');
	}
	return caller;
}

/**
 * GET /api/back-office/referral
 * List referrals for a shelter (filter by status or evacuee_id)
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeReferral(request.headers.get('cookie'));

		// Resolve which shelter db to query
		let shelterCode = url.searchParams.get('shelter_code') || undefined;
		if (!caller.isSA) {
			shelterCode = caller.shelterCode || undefined;
		} else {
			shelterCode = shelterCode || 'SH001';
		}

		if (!shelterCode) {
			return json({ error: 'Missing shelter_code scope' }, { status: 400 });
		}

		const status = (url.searchParams.get('status') as ReferralStatus) || undefined;
		const evacueeId = url.searchParams.get('evacuee_id') || undefined;

		const repo = new ReferralRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
		const list = await repo.list({ status, evacuee_id: evacueeId });

		return json(list);
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string }; message?: string };
		const status = err.status || 500;
		const message = err.body?.message || err.message || 'Internal Server Error';
		return json({ error: message }, { status });
	}
};

/**
 * POST /api/back-office/referral
 * Create a new draft referral
 */
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeReferral(request.headers.get('cookie'));

		// Resolve which shelter db to write to
		let shelterCode = url.searchParams.get('shelter_code') || undefined;
		if (!caller.isSA) {
			shelterCode = caller.shelterCode || undefined;
		} else {
			shelterCode = shelterCode || 'SH001';
		}

		if (!shelterCode) {
			return json({ error: 'Missing shelter_code scope' }, { status: 400 });
		}

		const body = await request.json().catch(() => ({}));
		const parsed = referralInputSchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 });
		}

		const repo = new ReferralRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
		const ctx = {
			shelterCode,
			createdBy: caller.name
		};

		const created = await repo.create(parsed.data, ctx);
		return json(created, { status: 201 });
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string }; message?: string };
		const status = err.status || 500;
		const message = err.body?.message || err.message || 'Internal Server Error';
		return json({ error: message }, { status });
	}
};
