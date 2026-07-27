/**
 * GET /api/back-office/shelter/[code]/dashboard/demographics
 *
 * Returns age-group and nationality breakdowns for currently checked-in evacuees
 * by querying the Dashboard-owned CouchDB Map/Reduce views in
 * `_design/app`.
 *
 * Security (security-rbac-bestpractices §2 & §3):
 *  - Caller must be authenticated and scoped to this shelter or be a SA.
 *  - Response contains ONLY aggregate counts — no individual PII.
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
	DemographicsPayloadSchema,
	rowsToAgeGroups,
	rowsToCountries
} from '$lib/features/dashboard';

export const prerender = false;

type GroupedDemographicRow = { key: string | number | null; value: number };

async function queryGroupedView(
	db: string,
	viewName: 'demographics_by_age' | 'demographics_by_country'
): Promise<GroupedDemographicRow[]> {
	const res = await adminRaw(`/${db}/_design/app/_view/${viewName}?group=true`, 'GET');

	if (res.status === 404) {
		throw new ServiceError('INTERNAL', `${viewName} view is not deployed for ${db}`);
	}
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `${viewName} view error (${res.status})`);
	}

	return ((res.data as { rows?: GroupedDemographicRow[] }).rows ?? []) as GroupedDemographicRow[];
}

function ageBucketForBirthYear(birthYear: number | null, currentYear: number): string {
	if (birthYear === null || !Number.isFinite(birthYear)) return 'unknown';
	const age = currentYear - (birthYear - 543);
	if (age <= 4) return '0-4';
	if (age <= 11) return '5-11';
	if (age <= 17) return '12-17';
	if (age <= 59) return '18-59';
	return '60+';
}

function ageRowsToBuckets(rows: GroupedDemographicRow[]) {
	const currentYear = new Date().getFullYear();
	return rows.map((row) => ({
		key: ageBucketForBirthYear(typeof row.key === 'number' ? row.key : null, currentYear),
		value: row.value
	}));
}

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const code = params.code;
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		const db = `shelter_${code.toLowerCase()}`;
		const [ageRows, countryRows] = await Promise.all([
			queryGroupedView(db, 'demographics_by_age'),
			queryGroupedView(db, 'demographics_by_country')
		]);

		const payload = DemographicsPayloadSchema.parse({
			shelter_code: code,
			age_groups: rowsToAgeGroups(ageRowsToBuckets(ageRows)),
			countries: rowsToCountries(
				countryRows.filter(
					(row): row is { key: string; value: number } => typeof row.key === 'string'
				)
			)
		});

		return json(payload);
	} catch (e) {
		return serviceError(e);
	}
};
