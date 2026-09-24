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
import { signResidenceMatchToken, verifyResidenceMatchToken } from './residence-match-token.server';
import { maskLastName } from '$lib/utils/mask';

export type ResidenceSearchQuery = ResidenceFields & {
	phone?: string | null;
};

export type ResidenceMatchChip = {
	match_token: string;
	landmark?: string | null;
	housing_type?: string | null;
	shelter_code?: string | null;
	shelter_name?: string | null;
	is_in_shelter?: boolean;
	primary_contact_masked?: string | null;
	matched_member_masked?: string | null;
	member_count?: number;
	pets?: Array<{ species: string; name?: string; count?: number; details?: string }>;
	address?: ResidenceFields | null;
};

type HouseholdDoc = ResidenceFields & {
	_id: string;
	type?: string;
	status?: string | null;
	head_evacuee_id?: string | null;
	pets?: Array<{ species: string; name?: string; count?: number; details?: string }>;
	latitude?: number | null;
	longitude?: number | null;
};

function maskPhone(phone: string | null | undefined): string {
	if (!phone?.trim()) return '***';
	const digits = phone.replace(/\D/g, '');
	if (digits.length === 10) {
		return `${digits.slice(0, 3)}-***-${digits.slice(-4)}`;
	}
	if (digits.length >= 7) {
		return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
	}
	return '***';
}

function toChip(
	tokenPayload:
		| { kind: 'shelter'; shelterCode: string; householdId: string }
		| { kind: 'unassigned'; registrationId: string },
	fields: Pick<ResidenceFields, 'residence_landmark' | 'housing_type'>,
	meta?: {
		shelter_code?: string | null;
		shelter_name?: string | null;
		primary_contact_masked?: string | null;
		matched_member_masked?: string | null;
		member_count?: number;
		pets?: Array<{ species: string; name?: string; count?: number; details?: string }>;
		address?: ResidenceFields | null;
	}
): ResidenceMatchChip {
	return {
		match_token: signResidenceMatchToken(tokenPayload),
		...(fields.residence_landmark?.trim() ? { landmark: fields.residence_landmark.trim() } : {}),
		...(fields.housing_type?.trim() ? { housing_type: fields.housing_type.trim() } : {}),
		...(meta?.shelter_code ? { shelter_code: meta.shelter_code } : {}),
		...(meta?.shelter_name ? { shelter_name: meta.shelter_name } : {}),
		...(meta?.primary_contact_masked
			? { primary_contact_masked: meta.primary_contact_masked }
			: {}),
		...(meta?.matched_member_masked ? { matched_member_masked: meta.matched_member_masked } : {}),
		...(typeof meta?.member_count === 'number' ? { member_count: meta.member_count } : {}),
		...(meta?.pets ? { pets: meta.pets } : {}),
		...(meta?.address ? { address: meta.address } : {}),
		is_in_shelter: tokenPayload.kind === 'shelter'
	};
}

/**
 * Find joinable shelter Households by Residence or Phone. Returns non-PII chips + tokens only.
 */
export async function findShelterResidenceMatches(
	shelterCode: string,
	query: ResidenceSearchQuery,
	shelterName?: string
): Promise<ResidenceMatchChip[]> {
	const rawPhone = query.phone?.replace(/\D/g, '') ?? '';
	const hasPhone = rawPhone.length >= 9;
	const hasRes = hasMinimumResidence(query);

	if (!hasPhone && !hasRes) return [];

	const db = shelterDbName(shelterCode);

	const phoneHouseholdIds = new Set<string>();
	const phoneMatchedEvacuees: Record<string, { _id: string; first_name: string; phone: string }> =
		{};

	if (hasPhone) {
		const phoneVariations = [
			rawPhone,
			rawPhone.startsWith('0') ? `+66${rawPhone.slice(1)}` : `0${rawPhone.slice(-9)}`
		];
		const evRes = await adminRaw(`/${db}/_find`, 'POST', {
			selector: {
				type: 'evacuee',
				phone: { $in: phoneVariations }
			},
			limit: 25,
			fields: ['_id', 'first_name', 'last_name', 'phone', 'household_id', 'is_head']
		});
		if (evRes.status < 400) {
			const evDocs =
				(
					evRes.data as {
						docs?: Array<{
							_id: string;
							first_name: string;
							last_name?: string;
							phone?: string;
							household_id?: string;
							is_head?: boolean;
						}>;
					} | null
				)?.docs ?? [];
			for (const ev of evDocs) {
				if (ev.household_id) {
					phoneHouseholdIds.add(ev.household_id);
					phoneMatchedEvacuees[ev.household_id] = {
						_id: ev._id,
						first_name: ev.first_name,
						phone: ev.phone || ''
					};
				}
			}
		}
	}

	const householdDocMap = new Map<string, HouseholdDoc>();

	// If query has address, search households by address
	if (hasRes) {
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
				'postal_code',
				'head_evacuee_id',
				'pets',
				'latitude',
				'longitude'
			]
		});

		if (res.status < 400) {
			const docs = ((res.data as { docs?: HouseholdDoc[] } | null)?.docs ?? []) as HouseholdDoc[];
			for (const d of docs) {
				if (isJoinableHouseholdStatus(d.status) && matchesResidenceAddress(query, d)) {
					householdDocMap.set(d._id, d);
				}
			}
		}
	}

	// Fetch households found via phone lookup if not already fetched
	for (const hhId of phoneHouseholdIds) {
		if (!householdDocMap.has(hhId)) {
			const hhRes = await adminRaw(`/${db}/${encodeURIComponent(hhId)}`, 'GET');
			if (hhRes.status < 400 && hhRes.data) {
				const d = hhRes.data as HouseholdDoc;
				if (d.type === 'household' && isJoinableHouseholdStatus(d.status)) {
					householdDocMap.set(d._id, d);
				}
			}
		}
	}

	const chips: ResidenceMatchChip[] = [];

	for (const doc of householdDocMap.values()) {
		// Fetch evacuees in this household to determine member count and primary contact
		const evRes = await adminRaw(`/${db}/_find`, 'POST', {
			selector: {
				type: 'evacuee',
				household_id: doc._id
			},
			limit: 50,
			fields: ['_id', 'first_name', 'last_name', 'phone', 'is_head']
		});

		const evList =
			(evRes.status < 400
				? (
						evRes.data as {
							docs?: Array<{
								_id: string;
								first_name: string;
								last_name?: string;
								phone?: string;
								is_head?: boolean;
							}>;
						} | null
					)?.docs
				: null) ?? [];
		const head =
			evList.find((e) => e.is_head) ||
			evList.find((e) => e._id === doc.head_evacuee_id) ||
			evList[0];
		const primaryMasked = head ? `${head.first_name} ${maskLastName(head.last_name)}`.trim() : null;

		let matchedMemberMasked: string | null = null;
		const matchedEv = phoneMatchedEvacuees[doc._id];
		if (matchedEv && (!head || matchedEv._id !== head._id)) {
			const firstChar = matchedEv.first_name?.[0] ?? '';
			matchedMemberMasked = `คุณ${firstChar}*** (${maskPhone(matchedEv.phone)})`;
		}

		chips.push(
			toChip(
				{ kind: 'shelter', shelterCode, householdId: doc._id },
				{
					residence_landmark: doc.residence_landmark,
					housing_type: doc.housing_type
				},
				{
					shelter_code: shelterCode,
					shelter_name: shelterName,
					primary_contact_masked: primaryMasked,
					matched_member_masked: matchedMemberMasked,
					member_count: evList.length,
					pets: doc.pets ?? [],
					address: {
						housing_type: doc.housing_type,
						residence_landmark: doc.residence_landmark,
						address_no: doc.address_no,
						village_no: doc.village_no,
						subdistrict: doc.subdistrict,
						district: doc.district,
						province: doc.province,
						postal_code: doc.postal_code
					}
				}
			)
		);
	}

	return chips;
}

/**
 * Find claimable unassigned registrations by Residence or Phone (Mongo via FastAPI).
 */
export async function findUnassignedResidenceMatches(
	query: ResidenceSearchQuery,
	fetchFn: typeof globalThis.fetch
): Promise<ResidenceMatchChip[]> {
	const rawPhone = query.phone?.replace(/\D/g, '') ?? '';
	const hasPhone = rawPhone.length >= 9;
	const hasRes = hasMinimumResidence(query);

	if (!hasPhone && !hasRes) return [];

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
					postal_code: query.postal_code ?? null,
					phone: query.phone ?? null
				})
			}
		);
	} catch {
		return [];
	}

	if (!apiRes.ok) return [];

	const body = (await apiRes.json().catch(() => null)) as {
		matches?: Array<{
			id: string;
			landmark?: string | null;
			housing_type?: string | null;
			claimed_shelter_code?: string | null;
			claimed_household_id?: string | null;
			status?: string;
			primary_contact_name_masked?: string | null;
			matched_member_masked?: string | null;
			member_count?: number;
			pets?: Array<{ species: string; name?: string; count?: number; details?: string }>;
			household_address?: ResidenceFields | null;
		}>;
	} | null;

	return (body?.matches ?? []).map((hit) => {
		const meta = {
			shelter_code: hit.claimed_shelter_code,
			primary_contact_masked: hit.primary_contact_name_masked,
			matched_member_masked: hit.matched_member_masked,
			member_count: hit.member_count,
			pets: hit.pets,
			address: hit.household_address
		};

		if (hit.claimed_shelter_code && hit.claimed_household_id) {
			return toChip(
				{
					kind: 'shelter',
					shelterCode: hit.claimed_shelter_code,
					householdId: hit.claimed_household_id
				},
				{
					residence_landmark: hit.landmark,
					housing_type: hit.housing_type
				},
				meta
			);
		}
		return toChip(
			{ kind: 'unassigned', registrationId: hit.id },
			{
				residence_landmark: hit.landmark,
				housing_type: hit.housing_type
			},
			meta
		);
	});
}

/**
 * Universal residence matching for unassigned flow:
 * 1. Queries unassigned registrations (Mongo - open and claimed)
 * 2. Queries open CouchDB shelter databases in parallel
 * 3. Merges and deduplicates matches
 */
export async function findUniversalResidenceMatches(
	query: ResidenceSearchQuery,
	fetchFn: typeof globalThis.fetch
): Promise<ResidenceMatchChip[]> {
	const rawPhone = query.phone?.replace(/\D/g, '') ?? '';
	const hasPhone = rawPhone.length >= 9;
	const hasRes = hasMinimumResidence(query);

	if (!hasPhone && !hasRes) return [];

	const unassignedPromise = findUnassignedResidenceMatches(query, fetchFn);

	const sheltersPromise = fetchFn(`${fastapiBaseUrl()}/public/v1/shelters`, {
		headers: fastapiServiceHeaders()
	})
		.then((r) => (r.ok ? r.json() : null))
		.catch(() => null);

	const [unassignedResult, sheltersResult] = await Promise.allSettled([
		unassignedPromise,
		sheltersPromise
	]);

	const unassignedMatches = unassignedResult.status === 'fulfilled' ? unassignedResult.value : [];
	const sheltersList =
		sheltersResult.status === 'fulfilled'
			? ((
					sheltersResult.value as {
						shelters?: Array<{ code: string; name: string; status?: string }>;
					} | null
				)?.shelters ?? [])
			: [];
	const openShelters = sheltersList.filter((s) => s.status?.toLowerCase() !== 'closed');

	// Populate shelter_name on unassigned matches that reference a claimed shelter
	for (const chip of unassignedMatches) {
		if (chip.shelter_code && !chip.shelter_name) {
			const found = openShelters.find((s) => s.code === chip.shelter_code);
			if (found) chip.shelter_name = found.name;
		}
	}

	// Query open shelters in CouchDB in parallel
	const shelterQueryPromises = openShelters.map(async (s) => {
		try {
			return await findShelterResidenceMatches(s.code, query, s.name);
		} catch {
			return [];
		}
	});

	const shelterQueryResults = await Promise.all(shelterQueryPromises);
	const shelterMatches = shelterQueryResults.flat();

	// Deduplicate by target household/registration identifier
	const seenTargets = new Set<string>();
	const combined: ResidenceMatchChip[] = [];

	for (const chip of [...shelterMatches, ...unassignedMatches]) {
		const payload = verifyResidenceMatchToken(chip.match_token);
		if (!payload) continue;
		const targetKey =
			payload.kind === 'shelter'
				? `shelter:${payload.shelterCode}:${payload.householdId}`
				: `unassigned:${payload.registrationId}`;

		if (!seenTargets.has(targetKey)) {
			seenTargets.add(targetKey);
			combined.push(chip);
		}
	}

	return combined;
}
