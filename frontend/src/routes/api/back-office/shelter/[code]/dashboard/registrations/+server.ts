/**
 * GET /api/back-office/shelter/[code]/dashboard/registrations
 *
 * Returns daily evacuee registration counts for the shelter, optionally
 * filtered to a date range via `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
 * When absent the range defaults to the past 30 days (see domain/schema.ts).
 *
 * CouchDB view: `registrations_by_date?group=true`
 * Key shape: YYYY-MM-DD  →  count
 * Date-range query: ?startkey="from"&endkey="to￰"
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
	defaultDateRange
} from '$lib/features/dashboard-registration';
import type { ViewResult } from '$lib/server/shelters.admin';

export const prerender = false;

// High-value sentinel: ensures all string sub-keys under a date prefix are included
// when used as endkey. (couchdb-pouchdb-bestpractices §6 CONVENTIONS.md §5)
const SENTINEL = '\ufff0';

export const GET: RequestHandler = async ({ params, request, url }) => {
	try {
		const code = params.code;
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		// Parse & validate optional query params.
		const rawQuery = {
			from: url.searchParams.get('from') ?? undefined,
			to: url.searchParams.get('to') ?? undefined
		};
		const query = RegistrationsQuerySchema.parse(rawQuery);

		// Apply defaults when params are absent.
		const defaults = defaultDateRange();
		const from = query.from ?? defaults.from;
		const to = query.to ?? defaults.to;

		const db = `shelter_${code.toLowerCase()}`;

		// CouchDB date-range query with the high-value sentinel on endkey
		// so all documents on the `to` date are included.
		const viewPath =
			`/${db}/_design/app/_view/registrations_by_date?group=true` +
			`&startkey=${encodeURIComponent(JSON.stringify(from))}` +
			`&endkey=${encodeURIComponent(JSON.stringify(to + SENTINEL))}`;

		const res = await adminRaw(viewPath, 'GET');

		if (res.status === 404) {
			return json(RegistrationsPayloadSchema.parse(rowsToRegistrationsPayload(code, [], from, to)));
		}
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', `registrations_by_date view error (${res.status})`);
		}

		const rows = (res.data as ViewResult).rows ?? [];
		const payload = RegistrationsPayloadSchema.parse(
			rowsToRegistrationsPayload(code, rows, from, to)
		);
		return json(payload);
	} catch (e) {
		return serviceError(e);
	}
};
