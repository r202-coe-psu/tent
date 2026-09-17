/**
 * Server helpers for public residence-match (no PII in response chips).
 */
import { adminRaw } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import {
	hasMinimumResidence,
	isJoinableHouseholdStatus,
	matchesResidenceAddress,
	type ResidenceFields
} from '$lib/features/people/server';
import { signResidenceMatchToken } from './residence-match-token.server';

export type ResidenceMatchChip = {
	match_token: string;
	landmark?: string | null;
	housing_type?: string | null;
};

type HouseholdDoc = ResidenceFields & {
	_id: string;
	type?: string;
	status?: string | null;
};

function toChip(
	tokenPayload:
		| { kind: 'shelter'; shelterCode: string; householdId: string }
		| { kind: 'unassigned'; registrationId: string },
	fields: Pick<ResidenceFields, 'residence_landmark' | 'housing_type'>
): ResidenceMatchChip {
	return {
		match_token: signResidenceMatchToken(tokenPayload),
		...(fields.residence_landmark?.trim() ? { landmark: fields.residence_landmark.trim() } : {}),
		...(fields.housing_type?.trim() ? { housing_type: fields.housing_type.trim() } : {})
	};
}

/**
 * Find joinable shelter Households by Residence. Returns non-PII chips + tokens only.
 */
export async function findShelterResidenceMatches(
	shelterCode: string,
	query: ResidenceFields
): Promise<ResidenceMatchChip[]> {
	if (!hasMinimumResidence(query)) return [];

	const db = shelterDbName(shelterCode);
	const selector: Record<string, unknown> = {
		type: 'household',
		status: { $in: ['pre_registered', 'arriving', 'checked_in'] }
	};

	if (query.housing_type === 'homeless' || !query.address_no?.trim()) {
		if (query.province?.trim()) selector.province = query.province.trim();
		if (query.district?.trim()) selector.district = query.district.trim();
		if (query.subdistrict?.trim()) selector.subdistrict = query.subdistrict.trim();
	} else if (query.address_no?.trim()) {
		selector.address_no = query.address_no.trim();
		if (query.province?.trim()) selector.province = query.province.trim();
	}

	const res = await adminRaw(`/${db}/_find`, 'POST', {
		selector,
		limit: 50,
		fields: [
			'_id',
			'type',
			'status',
			'housing_type',
			'residence_landmark',
			'address_no',
			'village_no',
			'subdistrict',
			'district',
			'province',
			'postal_code'
		]
	});

	if (res.status >= 400) return [];

	const docs = ((res.data as { docs?: HouseholdDoc[] } | null)?.docs ?? []) as HouseholdDoc[];
	return docs
		.filter((doc) => isJoinableHouseholdStatus(doc.status) && matchesResidenceAddress(query, doc))
		.map((doc) =>
			toChip(
				{ kind: 'shelter', shelterCode, householdId: doc._id },
				{
					residence_landmark: doc.residence_landmark,
					housing_type: doc.housing_type
				}
			)
		);
}

/**
 * Find claimable unassigned registrations by Residence (Mongo via FastAPI).
 */
export async function findUnassignedResidenceMatches(
	query: ResidenceFields,
	fetchFn: typeof globalThis.fetch
): Promise<ResidenceMatchChip[]> {
	if (!hasMinimumResidence(query)) return [];

	let apiRes: Response;
	try {
		apiRes = await fetchFn(
			`${fastapiBaseUrl()}/public/v1/unassigned-registrations/residence-match`,
			{
				method: 'POST',
				headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
				body: JSON.stringify({
					housing_type: query.housing_type ?? null,
					residence_landmark: query.residence_landmark ?? null,
					address_no: query.address_no ?? null,
					village_no: query.village_no ?? null,
					subdistrict: query.subdistrict ?? null,
					district: query.district ?? null,
					province: query.province ?? null,
					postal_code: query.postal_code ?? null
				})
			}
		);
	} catch {
		return [];
	}

	if (!apiRes.ok) return [];

	const body = (await apiRes.json().catch(() => null)) as {
		matches?: Array<{ id: string; landmark?: string | null; housing_type?: string | null }>;
	} | null;

	return (body?.matches ?? []).map((hit) =>
		toChip(
			{ kind: 'unassigned', registrationId: hit.id },
			{
				residence_landmark: hit.landmark,
				housing_type: hit.housing_type
			}
		)
	);
}
