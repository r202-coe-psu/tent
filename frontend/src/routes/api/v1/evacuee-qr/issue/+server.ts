import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeSession, ServiceError, serviceError } from '$lib/server/couch-admin';
import { issueEvacueeQr } from '$lib/server/evacuee-qr-service';
import { canAccessEvacueeRegistration } from '$lib/auth/roles';
import { EVACUEE_ID, type EvacueeQrSource } from '$lib/utils/evacuee-qr';

/**
 * POST /api/v1/evacuee-qr/issue (CR-233 FR-EQR-25/26, api-contract §2.8)
 *
 * Body: `{ shelter_code, source: 'profile' | 'family_batch', evacuee_ids: string[] (1..30) }`
 * 200:  `{ items: [{ evacuee_id, status, qr_payload?, printed_at? }] }`
 *
 * Per-item `status`:
 *   - `issued`    — entry written; `qr_payload` + `printed_at` present
 *   - `not_found` — evacuee does not exist in `shelter_{code}`; nothing written
 *   - `failed`    — entry could not be written (CONFLICT after 5 tries, CouchDB error, malformed id)
 *
 * Errors (envelope `{ error: { code, message } }`): 401 no session · 403 caller is not system_admin /
 * shelter_manager / registration_staff of `shelter_code` · 422 invalid body (incl. ids that are not
 * `evacuee:{ULID}`) · 503 `DEPENDENCY_UNAVAILABLE` when CouchDB is unreachable for the whole request.
 * `printed_by` is the staff username from `_session`, never from the body. Ids are processed
 * sequentially so every issue is one entry (FR-EQR-21c).
 *
 * Operational notes:
 *   - Partial failure: ids issued before a failing one are already rotated (FR-EQR-20 — the log is
 *     written before printing and never rolled back); the client skips the non-`issued` items and
 *     tells the user to print them again.
 *   - Central only: like the other admin-credential BFF routes (e.g. staff-card), this writes through
 *     `COUCHDB_ADMIN_URL`. With WAN down no new QR can be issued — the print fails and the previous
 *     QR stays valid (never a silent fallback to an unlogged payload).
 *   - Deploy: shelters provisioned before CR-233 need `pnpm redeploy:access --write --confirm`
 *     (already part of `pnpm db:sync`) so `_design/access` accepts `evacuee_qr`.
 */
export const prerender = false;

const MAX_IDS = 30;
const SHELTER_CODE = /^[A-Za-z0-9_-]+$/;
const SOURCES: readonly EvacueeQrSource[] = ['profile', 'family_batch'];

type IssueItem = {
	evacuee_id: string;
	status: 'issued' | 'not_found' | 'failed';
	qr_payload?: string;
	printed_at?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeSession(request.headers.get('cookie'));
		const body = (await request.json().catch(() => null)) as {
			shelter_code?: unknown;
			source?: unknown;
			evacuee_ids?: unknown;
		} | null;

		const shelterCode = typeof body?.shelter_code === 'string' ? body.shelter_code.trim() : '';
		if (!shelterCode || !SHELTER_CODE.test(shelterCode)) {
			throw new ServiceError('VALIDATION', 'shelter_code is required');
		}
		if (!SOURCES.includes(body?.source as EvacueeQrSource)) {
			throw new ServiceError('VALIDATION', "source must be 'profile' or 'family_batch'");
		}
		const ids = body?.evacuee_ids;
		if (
			!Array.isArray(ids) ||
			ids.length === 0 ||
			ids.length > MAX_IDS ||
			ids.some((id) => typeof id !== 'string' || !EVACUEE_ID.test(id))
		) {
			throw new ServiceError(
				'VALIDATION',
				`evacuee_ids must be 1..${MAX_IDS} ids of the form evacuee:{ULID}`
			);
		}
		if (new Set(ids).size !== ids.length) {
			throw new ServiceError('VALIDATION', 'evacuee_ids must be unique');
		}

		// Role comes from `_session`, never the body (FR-EQR-26). Same gate as every route that can
		// open the Person QR print UI (`requireEvacueeRegistration`): system_admin, or
		// shelter_manager / registration_staff of this shelter.
		if (!canAccessEvacueeRegistration(caller.roles, shelterCode)) {
			throw new ServiceError('FORBIDDEN', 'Registration access to this shelter is required');
		}

		const items: IssueItem[] = [];
		let unavailable = 0;
		for (const evacuee_id of ids as string[]) {
			try {
				const issued = await issueEvacueeQr({
					shelter_code: shelterCode,
					evacuee_id,
					source: body!.source as EvacueeQrSource,
					printed_by: caller.name
				});
				items.push({ status: 'issued', ...issued });
			} catch (e) {
				// A thrown non-ServiceError is a network failure reaching CouchDB.
				if (!(e instanceof ServiceError) || e.code === 'DEPENDENCY_UNAVAILABLE') unavailable++;
				const notFound = e instanceof ServiceError && e.code === 'NOT_FOUND';
				items.push({ evacuee_id, status: notFound ? 'not_found' : 'failed' });
			}
		}
		// Whole request down (nothing issued, every id hit an outage): 503, not a 200 full of `failed`.
		if (unavailable === ids.length) {
			throw new ServiceError('DEPENDENCY_UNAVAILABLE', 'CouchDB is unavailable');
		}
		return json({ items }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		return serviceError(e);
	}
};
