import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listShelterMasters, migrate } from '$lib/server/shelters.admin';
import { adminRaw } from '$lib/server/couch-admin';
import { maskNationalId } from '$lib/features/people';

type EvacueeDoc = {
	_id: string;
	first_name: string;
	last_name: string;
	household_id?: string;
	person_id?: { number: string };
	gender?: string;
	privacy?: { search_excluded?: boolean };
	current_stay?: { since?: string; zone?: string; status?: string };
};

type CouchDBResponse = { docs?: EvacueeDoc[] };
type HouseholdDoc = {
	address_no?: string;
	subdistrict?: string;
	district?: string;
	province?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	let query = '';
	try {
		const body = await request.json();
		query = body.query || '';
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const q = query.trim();
	if (q.length < 3) {
		return json({ error: 'Query must be at least 3 characters long' }, { status: 400 });
	}

	const isNumeric = /^\d+$/.test(q);
	const isPassport = /^[A-Z0-9]+$/i.test(q);

	const selector: Record<string, unknown> = { type: 'evacuee' };

	if (isNumeric && q.length === 13) {
		selector['person_id.number'] = q;
	} else if (isNumeric && q.length >= 9) {
		selector['phone'] = q;
	} else if (isPassport && q.length >= 7 && q.length <= 9) {
		selector['person_id.number'] = q;
	} else {
		// Fallback for name - CouchDB Mango Regex search:
		const parts = q.split(/\s+/);
		if (parts.length >= 2) {
			selector['$and'] = [
				{ first_name: { $regex: `(?i).*${parts[0]}.*` } },
				{ last_name: { $regex: `(?i).*${parts.slice(1).join(' ')}.*` } }
			];
		} else {
			selector['$or'] = [
				{ first_name: { $regex: `(?i).*${q}.*` } },
				{ last_name: { $regex: `(?i).*${q}.*` } }
			];
		}
	}

	const masters = await listShelterMasters();
	const activeShelters = masters.map(migrate).filter((m) => m.operation_status !== 'closed');

	const results = [];

	for (const m of activeShelters) {
		try {
			const res = await adminRaw(`/shelter_${m.code.toLowerCase()}/_find`, 'POST', {
				selector,
				limit: 20
			});

			if (res.status === 200 && res.data && (res.data as CouchDBResponse).docs) {
				const docs = (res.data as CouchDBResponse).docs || [];
				for (const doc of docs) {
					if (doc.privacy?.search_excluded) continue;

					let household = null;
					let familyMembers: EvacueeDoc[] = [];

					if (doc.household_id) {
						try {
							const hhRes = await adminRaw(
								`/shelter_${m.code.toLowerCase()}/${doc.household_id}`,
								'GET'
							);
							if (hhRes.status === 200 && hhRes.data) {
								household = hhRes.data as HouseholdDoc;
							}

							const fmRes = await adminRaw(`/shelter_${m.code.toLowerCase()}/_find`, 'POST', {
								selector: { type: 'evacuee', household_id: doc.household_id }
							});

							if (fmRes.status === 200 && fmRes.data && (fmRes.data as CouchDBResponse).docs) {
								const fDocs = (fmRes.data as CouchDBResponse).docs || [];
								familyMembers = fDocs.filter(
									(f) => f._id !== doc._id && !f.privacy?.search_excluded
								);
							}
						} catch {
							// ignore
						}
					}

					results.push({
						id: doc._id,
						first_name: doc.first_name,
						last_name_masked: maskLastName(doc.last_name),
						national_id: maskNationalId(doc.person_id?.number),
						gender: doc.gender,
						shelter_name: m.name,
						origin_address: maskAddress(household),
						checked_in_at: doc.current_stay?.since,
						care_zone: doc.current_stay?.zone || 'General',
						status: doc.current_stay?.status,
						family_members: familyMembers.map((f) => ({
							first_name: f.first_name,
							last_name_masked: maskLastName(f.last_name),
							status: f.current_stay?.status,
							shelter_name: m.name
						}))
					});
				}
			}
		} catch {
			console.error(`Error querying shelter_${m.code}`);
		}
	}

	return json({ results });
};

function maskLastName(lastName: string) {
	if (!lastName) return '';
	return lastName.charAt(0) + '*'.repeat(Math.max(1, lastName.length - 1));
}

function maskAddress(household: HouseholdDoc | null) {
	if (!household) return 'ไม่ระบุ';
	let addr = '';
	if (household.address_no) addr += '**/* ';
	if (household.subdistrict) addr += `ต.${household.subdistrict} `;
	if (household.district) addr += `อ.${household.district} `;
	if (household.province) addr += `จ.${household.province}`;
	return addr.trim() || 'ไม่ระบุ';
}
