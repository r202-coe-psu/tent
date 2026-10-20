/**
 * GET /api/back-office/shelter/[code]/dashboard/registrations
 *
 * Returns daily evacuee registration counts for the shelter, optionally
 * filtered to a date range via `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
 * When `from` is absent the range starts the day the shelter was created (registry
 * `created_at`, or the earliest movement if one predates it); `to` defaults to today,
 * both Asia/Bangkok (see `defaultRangeFrom` in domain/registration.schema.ts).
 *
 * CouchDB view: `registrations_by_date_status?group=true`
 * Key shape: [YYYY-MM-DD, series]  →  count
 * Date-range query: ?startkey=["from", ""]&endkey=["to￰", "￰"]
 *   (the ￰ high-value sentinel includes all sub-keys; CONVENTIONS.md §5)
 *
 * Security (security-rbac-bestpractices §2 & §3):
 *  - Caller must be authenticated and scoped to this shelter or be a SA.
 *  - Response contains ONLY daily aggregate counts — no individual PII.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	requireShelterScopeOrSA,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import {
	RegistrationsQuerySchema,
	RegistrationsPayloadSchema,
	rowsToRegistrationsPayload,
	defaultRangeFrom
} from '$lib/features/dashboard';
import { findMasterByCode, type ViewResult } from '$lib/server/shelters.admin';
import { bangkokToday } from '$lib/utils/date';
import { checkViewDeployment } from '$lib/features/shelters/server/view-version-guard';

export const prerender = false;

// High-value sentinel: ensures all string sub-keys under a date prefix are included
// when used as endkey. (couchdb-pouchdb-bestpractices §6 CONVENTIONS.md §5)
const SENTINEL = '\ufff0';

/** The date of the first grouped row — rows come back sorted by `[date, series]`. */
function firstRowDate(rows: { key: string | string[] }[]): string | undefined {
	const key = rows[0]?.key;
	return Array.isArray(key) ? key[0] : key;
}

export const GET: RequestHandler = async ({ params, request, url }) => {
	try {
		const code = params.code;
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		// Parse & validate optional query params.
		const rawQuery = {
			from: url.searchParams.get('from') ?? undefined,
			to: url.searchParams.get('to') ?? undefined
		};
		const parsed = RegistrationsQuerySchema.safeParse(rawQuery);
		if (!parsed.success) {
			throw new ServiceError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid date range');
		}
		const query = parsed.data;

		const to = query.to ?? bangkokToday();

		const db = `shelter_${code.toLowerCase()}`;

		const deployment = await checkViewDeployment(db, adminRaw);
		if (deployment.state === 'stale') {
			throw new ServiceError(
				'INTERNAL',
				`Dashboard views for ${db} are on an older version (deployed=${deployment.deployedVersion}) than this app build expects — a redeploy of _design/app is pending`
			);
		}

		// CouchDB date-range query with the high-value sentinel on endkey
		// so all documents on the `to` date are included. Array keys are used for [date, series].
		// Without `from` the view is read from its first key, which also tells us the
		// earliest movement — one grouped row per day and series, so this stays small.
		const startkey = query.from
			? `&startkey=${encodeURIComponent(JSON.stringify([query.from, '']))}`
			: '';
		const viewPath =
			`/${db}/_design/app/_view/registrations_by_date_status?group=true` +
			startkey +
			`&endkey=${encodeURIComponent(JSON.stringify([to + SENTINEL, SENTINEL]))}`;

		const res = await adminRaw(viewPath, 'GET');

		if (res.status === 404) {
			throw new ServiceError('INTERNAL', 'Dashboard registrations view is not deployed');
		}
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', `registrations_by_date_status view error (${res.status})`);
		}

		const rows = (res.data as ViewResult).rows ?? [];
		const from =
			query.from ??
			defaultRangeFrom((await findMasterByCode(code))?.created_at, firstRowDate(rows), to);
		const payload = RegistrationsPayloadSchema.parse(
			rowsToRegistrationsPayload(code, rows, from, to)
		);
		return json(payload);
	} catch (e) {
		return serviceError(e);
	}
};
