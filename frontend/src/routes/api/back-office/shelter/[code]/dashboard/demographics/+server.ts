/**
 * GET /api/back-office/shelter/[code]/dashboard/demographics
 *
 * Returns age-group and nationality breakdowns for currently checked-in evacuees
 * by querying the shelter database with a server-side Mango `_find` selector.
 * Only aggregate fields needed for the response are projected.
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

const FIND_PAGE_SIZE = 1000;

type DemographicDoc = {
	current_stay?: { status?: string };
	birth_year?: number | null;
	country?: string | null;
};

/** Read only the fields needed for aggregate demographics, paged by bookmark. */
async function findActiveEvacuees(db: string): Promise<DemographicDoc[] | null> {
	const docs: DemographicDoc[] = [];
	let bookmark: string | undefined;

	for (;;) {
		const res = await adminRaw(`/${db}/_find`, 'POST', {
			selector: {
				type: 'evacuee',
				'current_stay.status': 'active'
			},
			fields: ['current_stay', 'birth_year', 'country'],
			limit: FIND_PAGE_SIZE,
			...(bookmark ? { bookmark } : {})
		});

		if (res.status === 404) return null;
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', `active evacuee query error (${res.status})`);
		}

		const data = (res.data as { docs?: DemographicDoc[]; bookmark?: string }) ?? {};
		const page = data.docs ?? [];
		docs.push(...page);

		const nextBookmark = data.bookmark;
		if (!nextBookmark || nextBookmark === bookmark || page.length < FIND_PAGE_SIZE) break;
		bookmark = nextBookmark;
	}

	return docs;
}

function docsToRows(docs: readonly DemographicDoc[]) {
	const ageCounts: Record<string, number> = {};
	const countryCounts: Record<string, number> = {};
	const currentYear = new Date().getFullYear();

	for (const doc of docs) {
		// Defensive filter: do not trust only the Mango selector.
		if (doc.current_stay?.status !== 'active') continue;

		let ageBucket = 'unknown';
		if (doc.birth_year) {
			const age = currentYear - (doc.birth_year - 543);
			if (age <= 4) ageBucket = '0-4';
			else if (age <= 11) ageBucket = '5-11';
			else if (age <= 17) ageBucket = '12-17';
			else if (age <= 59) ageBucket = '18-59';
			else ageBucket = '60+';
		}
		ageCounts[ageBucket] = (ageCounts[ageBucket] ?? 0) + 1;

		const country = (doc.country ?? '').trim().toUpperCase() || 'UNKNOWN';
		countryCounts[country] = (countryCounts[country] ?? 0) + 1;
	}

	return {
		ageRows: Object.entries(ageCounts).map(([key, value]) => ({ key, value })),
		countryRows: Object.entries(countryCounts).map(([key, value]) => ({ key, value }))
	};
}

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const code = params.code;
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		const db = `shelter_${code.toLowerCase()}`;

		// Query current evacuee documents so this endpoint does not depend on
		// a stale persisted _design/app demographics view.
		const docs = await findActiveEvacuees(db);

		// 404 means the shelter database is not available — return zeroes gracefully.
		if (!docs) {
			return json(
				DemographicsPayloadSchema.parse({
					shelter_code: code,
					age_groups: { '0-4': 0, '5-11': 0, '12-17': 0, '18-59': 0, '60+': 0, unknown: 0 },
					countries: {}
				})
			);
		}
		const { ageRows, countryRows } = docsToRows(docs);

		const payload = DemographicsPayloadSchema.parse({
			shelter_code: code,
			age_groups: rowsToAgeGroups(ageRows),
			countries: rowsToCountries(countryRows)
		});

		return json(payload);
	} catch (e) {
		return serviceError(e);
	}
};
