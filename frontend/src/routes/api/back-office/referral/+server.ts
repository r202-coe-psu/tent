/* eslint-disable no-restricted-imports */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeReferral, resolveShelterCode, handleEndpointError } from './_auth';
import { CouchDbReferralServerRepository } from '$lib/features/referrals/server/referral.server-repository';
import {
	referralInputSchema,
	referralListQuerySchema
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

/** Parse list query params; invalid values answer 400 `{ error }` via `handleEndpointError`. */
function parseListQuery(params: URLSearchParams) {
	const raw: Record<string, string> = {};
	for (const key of ['limit', 'bookmark', 'status', 'direction', 'sort', 'evacuee_id']) {
		const value = params.get(key);
		if (value) raw[key] = value;
	}
	const parsed = referralListQuerySchema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw error(
			400,
			`Invalid query: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim()
		);
	}
	return parsed.data;
}

/**
 * GET /api/back-office/referral
 * One page of referrals for a shelter: `{ items, bookmark, has_more }`.
 * Params: limit (1–200, default 50), bookmark, status, direction, sort, evacuee_id.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeReferral(request.headers.get('cookie'));

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const query = parseListQuery(url.searchParams);

		const repo = new CouchDbReferralServerRepository('central_ops', shelterCode);
		const page = await repo.listPage(query);

		return json({
			items: page.items.map((doc) => redactForScope(doc, BACK_OFFICE_SCOPE)),
			bookmark: page.bookmark,
			has_more: page.hasMore
		});
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

		const evacueeDoc = evacueeRes.data;
		const evacueeSummary = {
			first_name: evacueeDoc.first_name,
			last_name: evacueeDoc.last_name,
			gender: evacueeDoc.gender ?? undefined
		};

		const repo = new CouchDbReferralServerRepository('central_ops', shelterCode);

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

		const created = await repo.create(parsed.data, ctx, evacueeSummary);
		return json(redactForScope(created, BACK_OFFICE_SCOPE), { status: 201 });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API POST');
	}
};
