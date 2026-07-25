/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeReferral, resolveShelterCode, handleEndpointError } from './_auth';
import { CouchDbReferralServerRepository } from '$lib/features/referrals/server/referral.server-repository';
import {
	referralInputSchema,
	type ReferralStatus
} from '$lib/features/referrals/domain/referral.schema';
import { redactForScope } from '$lib/features/referrals/domain/referral.redaction';
import { adminRaw } from '$lib/server/couch-admin';
import { isEvacuee } from '$lib/features/people/domain/people';

export const prerender = false;

/**
 * Back-office BFF is shelter_manager / SA only → always `internal` (no-op redaction).
 * Public / FAM / EOC / Open API MUST call `redactForScope(doc, scope)` with a non-internal
 * scope before returning referral payloads (FR-48 / NFR-5).
 */
const BACK_OFFICE_SCOPE = 'internal' as const;

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

		return json(list.map((doc) => redactForScope(doc, BACK_OFFICE_SCOPE)));
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API GET');
	}
};

/**
 * POST /api/back-office/referral
 * Create a new draft referral
 *
 * Admin/debug path — SPA create uses session remote (`referral.remote.ts`).
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

		// FR-001: Self-referral guard
		if (
			parsed.data.referral_type === 'capacity' &&
			parsed.data.to_shelter_code?.toUpperCase() === shelterCode.toUpperCase()
		) {
			return json(
				{ error: 'ไม่สามารถส่งต่อผู้ประสบภัยไปยังศูนย์พักพิงเดียวกันได้' },
				{ status: 422 }
			);
		}

		const db = `shelter_${shelterCode.toLowerCase()}`;
		const evacueeRes = await adminRaw(
			`/${db}/${encodeURIComponent(parsed.data.evacuee_id)}`,
			'GET'
		);
		if (evacueeRes.status === 404 || !isEvacuee(evacueeRes.data)) {
			return json(
				{ error: `Evacuee with ID ${parsed.data.evacuee_id} was not found in the active shelter.` },
				{ status: 422 }
			);
		}

		const repo = new CouchDbReferralServerRepository(db);

		// FR-002: Duplicate active referral check
		const hasDuplicate = await repo.hasActiveReferral(parsed.data.evacuee_id);
		if (hasDuplicate) {
			return json(
				{ error: 'ผู้ประสบภัยรายนี้มีคำร้องส่งต่อที่ยังดำเนินการอยู่ กรุณาปิดคำร้องเดิมก่อน' },
				{ status: 409 }
			);
		}

		const ctx = {
			shelterCode,
			createdBy: caller.name
		};

		const created = await repo.create(parsed.data, ctx);
		return json(redactForScope(created, BACK_OFFICE_SCOPE), { status: 201 });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API POST');
	}
};
