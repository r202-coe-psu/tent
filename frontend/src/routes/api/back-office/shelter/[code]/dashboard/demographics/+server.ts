/**
 * GET /api/back-office/shelter/[code]/dashboard/demographics
 *
 * Returns age-group and nationality breakdowns by querying two CouchDB views
 * in parallel (couchdb-pouchdb-bestpractices §6 — views called server-side only):
 *   1. `demographics_by_age?group=true`
 *   2. `demographics_by_country?group=true`
 *
 * Security (security-rbac-bestpractices §2 & §3):
 *  - Caller must be authenticated and scoped to this shelter or be a SA.
 *  - Response contains ONLY aggregate counts — no individual PII.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireShelterScopeOrSA, serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	DemographicsPayloadSchema,
	rowsToAgeGroups,
	rowsToCountries
} from '$lib/features/dashboard-demographics';

export const prerender = false;

interface ViewResult {
	rows: { key: string; value: number }[];
}

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const code = params.code;
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		const db = `shelter_${code.toLowerCase()}`;

		// Fetch both views in parallel to minimise latency.
		const [ageRes, natRes] = await Promise.all([
			adminRaw(`/${db}/_design/app/_view/demographics_by_age?group=true`, 'GET'),
			adminRaw(`/${db}/_design/app/_view/demographics_by_country?group=true`, 'GET')
		]);

		// 404 means views not yet deployed — return zeroed payload gracefully.
		if (ageRes.status === 404 || natRes.status === 404) {
			return json(
				DemographicsPayloadSchema.parse({
					shelter_code: code,
					age_groups: { '0-4': 0, '5-11': 0, '12-17': 0, '18-59': 0, '60+': 0, unknown: 0 },
					countries: {}
				})
			);
		}
		if (ageRes.status >= 400) {
			throw new ServiceError('INTERNAL', `demographics_by_age view error (${ageRes.status})`);
		}
		if (natRes.status >= 400) {
			throw new ServiceError('INTERNAL', `demographics_by_country view error (${natRes.status})`);
		}

		const ageRows = (ageRes.data as ViewResult).rows ?? [];
		const natRows = (natRes.data as ViewResult).rows ?? [];

		const payload = DemographicsPayloadSchema.parse({
			shelter_code: code,
			age_groups: rowsToAgeGroups(ageRows),
			countries: rowsToCountries(natRows)
		});

		return json(payload);
	} catch (e) {
		return serviceError(e);
	}
};
