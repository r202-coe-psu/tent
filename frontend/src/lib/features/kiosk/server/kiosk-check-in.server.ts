import { dev } from '$app/environment';
import { z } from 'zod';
import { now } from '$lib/db/model';
import { deriveHouseholdStatus, stayStatusSchema } from '$lib/features/people/domain/people';
import { isAlreadyCheckedInStatus, isListedHouseholdMember } from '../domain/check-in-status';
import { normalizeKioskPhone, phoneVariants } from '../domain/phone';
import {
	groupPhoneMatches,
	KIOSK_PHONE_MAX_CANDIDATES,
	isPhoneMatchEligible
} from '../domain/phone-match';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { maskLastName } from '$lib/utils/mask';

const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const evacueeIdSchema = z.string().regex(new RegExp(`^evacuee:${ULID}$`, 'i'));

export const kioskGateInputSchema = z.discriminatedUnion('source', [
	z.object({ source: z.literal('smart-card'), citizen_id: z.string().regex(/^\d{13}$/) }),
	z.object({
		source: z.literal('qr'),
		token: evacueeIdSchema
	}),
	z.object({
		source: z.literal('phone'),
		phone: z.string().min(1).max(20),
		primary_evacuee_id: evacueeIdSchema.optional()
	})
]);

export const kioskCheckInInputSchema = z.object({
	primary_evacuee_id: evacueeIdSchema,
	evacuee_ids: z.array(evacueeIdSchema).min(1).max(20)
});

type Stay = { status?: string; zone?: string | null; since?: string };
type EvacueeDoc = {
	_id: string;
	_rev?: string;
	type?: string;
	shelter_code?: string;
	registered_via?: string;
	first_name?: string;
	last_name?: string;
	gender?: string;
	age?: number;
	birth_year?: number;
	household_id?: string | null;
	current_stay?: Stay;
	privacy?: { search_excluded?: boolean };
	created_at?: string;
	updated_at?: string;
	[key: string]: unknown;
};

export interface KioskEvacueeSummary {
	evacuee_id: string;
	first_name: string;
	last_name: string;
	gender: string | null;
	age: number | null;
	status: string;
	is_primary: boolean;
	phone_matched?: boolean;
	selectable: boolean;
}

export interface KioskLookupResult {
	shelter_code: string;
	primary_evacuee_id: string;
	members: KioskEvacueeSummary[];
}

export interface KioskHouseholdCandidate {
	primary_evacuee_id: string;
	contact_display: string;
	member_count: number;
	pending_count: number;
}

export type KioskLookupOutcome =
	| ({ kind: 'household'; name_masked: boolean } & KioskLookupResult)
	| { kind: 'candidates'; shelter_code: string; candidates: KioskHouseholdCandidate[] }
	| { kind: 'not_found' }
	| { kind: 'too_many' };

export class KioskInputError extends Error {
	constructor() {
		super('Invalid kiosk gate input');
		this.name = 'KioskInputError';
	}
}

export type KioskCheckInMemberResult = {
	evacuee_id: string;
	status: 'checked_in' | 'already_checked_in' | 'not_found' | 'not_eligible' | 'failed';
	stay_status?: string;
	qr_payload?: string;
};

function isEvacueeDoc(value: unknown): value is EvacueeDoc {
	return typeof value === 'object' && value !== null && (value as EvacueeDoc).type === 'evacuee';
}

function responseStatus(error: unknown): number | null {
	if (typeof error !== 'object' || error === null || !('status' in error)) return null;
	const status = (error as { status?: unknown }).status;
	return typeof status === 'number' ? status : null;
}

function toSummary(
	doc: EvacueeDoc,
	primaryId: string,
	options: { matchedPhoneIds?: ReadonlySet<string> } = {}
): KioskEvacueeSummary {
	const status = doc.current_stay?.status ?? 'unknown';
	return {
		evacuee_id: doc._id,
		first_name: doc.first_name ?? '',
		last_name: maskLastName(doc.last_name),
		gender: doc.gender ?? null,
		age: typeof doc.age === 'number' ? doc.age : null,
		status,
		is_primary: doc._id === primaryId,
		...(options.matchedPhoneIds ? { phone_matched: options.matchedPhoneIds.has(doc._id) } : {}),
		selectable: doc.registered_via === 'web' && status === 'pre_registered'
	};
}

async function expandHousehold(
	dbName: string,
	primary: EvacueeDoc,
	shelterCode: string
): Promise<EvacueeDoc[]> {
	const members: EvacueeDoc[] = [primary];
	if (!primary.household_id) return members;

	const householdResult = await adminFetch<{ docs?: unknown[] }>(`/${dbName}/_find`, {
		method: 'POST',
		body: JSON.stringify({
			selector: {
				type: 'evacuee',
				household_id: primary.household_id,
				shelter_code: shelterCode
			},
			limit: 100
		})
	});
	for (const doc of (householdResult.docs ?? []).filter(isEvacueeDoc)) {
		if (
			doc._id !== primary._id &&
			doc.shelter_code === shelterCode &&
			doc.household_id === primary.household_id &&
			isListedHouseholdMember(doc)
		) {
			members.push(doc);
		}
	}
	return members;
}

async function getById(dbName: string, id: string): Promise<EvacueeDoc | null> {
	try {
		const doc = await adminFetch<EvacueeDoc>(`/${dbName}/${encodeURIComponent(id)}`);
		return isEvacueeDoc(doc) ? doc : null;
	} catch (error) {
		if (responseStatus(error) === 404) return null;
		throw error;
	}
}

async function lookupByPhone(
	shelterCode: string,
	rawPhone: string,
	primaryId?: string
): Promise<KioskLookupOutcome> {
	const canonical = normalizeKioskPhone(rawPhone);
	if (!canonical) throw new KioskInputError();

	const dbName = shelterDbName(shelterCode);
	const variants = phoneVariants(canonical);
	// Query each stored representation with equality so CouchDB can use the
	// (type, phone) index. The second query covers legacy +66 values.
	const pageLimit = 50;
	const maxPages = 20;
	const docsById = new Map<string, EvacueeDoc>();
	let truncated = false;
	for (const phone of variants) {
		let bookmark: string | undefined;
		for (let page = 0; page < maxPages; page += 1) {
			const result = await adminFetch<{ docs?: unknown[]; bookmark?: string }>(`/${dbName}/_find`, {
				method: 'POST',
				body: JSON.stringify({
					selector: {
						type: 'evacuee',
						shelter_code: shelterCode,
						registered_via: 'web',
						phone
					},
					fields: [
						'_id',
						'type',
						'shelter_code',
						'registered_via',
						'household_id',
						'created_at',
						'current_stay',
						'privacy',
						'first_name',
						'last_name'
					],
					limit: pageLimit,
					...(bookmark ? { bookmark } : {})
				})
			});
			const rawPageDocs = result.docs ?? [];
			for (const doc of rawPageDocs.filter(isEvacueeDoc)) docsById.set(doc._id, doc);
			if (rawPageDocs.length < pageLimit) break;
			if (!result.bookmark || result.bookmark === bookmark) {
				truncated = true;
				break;
			}
			bookmark = result.bookmark;
			if (page === maxPages - 1) truncated = true;
		}
		if (truncated) break;
	}
	const docs = [...docsById.values()];
	// A capped or malformed page sequence cannot prove there are five or fewer groups.
	// Fail closed instead of returning an incomplete household picker.
	if (truncated) {
		if (dev) {
			console.info('[Kiosk lookup] Phone match result', {
				gate: 'phone',
				candidate_count: docs.length,
				outcome: 'too_many',
				truncated: true
			});
		}
		return { kind: 'too_many' };
	}
	const householdIds = [
		...new Set(docs.map((doc) => doc.household_id).filter((id): id is string => Boolean(id)))
	];
	const headByHousehold = new Map<string, string | null>();
	if (householdIds.length > 0) {
		const allDocs = await adminFetch<{
			rows?: Array<{ doc?: { _id?: string; type?: string; head_evacuee_id?: string | null } }>;
		}>(`/${dbName}/_all_docs?include_docs=true`, {
			method: 'POST',
			body: JSON.stringify({ keys: householdIds })
		});
		for (const row of allDocs.rows ?? []) {
			const household = row.doc;
			if (household?.type === 'household' && household._id) {
				headByHousehold.set(
					household._id,
					typeof household.head_evacuee_id === 'string' ? household.head_evacuee_id : null
				);
			}
		}
	}

	const groups = groupPhoneMatches(docs, shelterCode, headByHousehold);
	if (groups.length > KIOSK_PHONE_MAX_CANDIDATES) return { kind: 'too_many' };
	if (dev) {
		console.info('[Kiosk lookup] Phone match result', {
			gate: 'phone',
			candidate_count: docs.length,
			group_count: groups.length,
			outcome: primaryId ? 'resolve_candidate' : groups.length === 0 ? 'not_found' : 'matched'
		});
	}

	const normalizedPrimaryId = primaryId
		? `evacuee:${primaryId.slice('evacuee:'.length).toUpperCase()}`
		: undefined;
	let group: (typeof groups)[number] | undefined;
	if (primaryId) {
		group = groups.find(
			(candidate) =>
				candidate.primary._id === normalizedPrimaryId ||
				candidate.matched.some((matched) => matched._id === normalizedPrimaryId)
		);
		if (!group) return { kind: 'not_found' };
	} else {
		if (groups.length === 0) return { kind: 'not_found' };
		if (groups.length > 1) {
			const householdIds = [
				...new Set(
					groups.map((candidate) => candidate.householdId).filter((id): id is string => Boolean(id))
				)
			];
			// Equality queries keep the (type, household_id) index usable.
			const memberResults = await Promise.all(
				householdIds.map((householdId) =>
					adminFetch<{ docs?: unknown[] }>(`/${dbName}/_find`, {
						method: 'POST',
						body: JSON.stringify({
							selector: {
								type: 'evacuee',
								household_id: householdId,
								shelter_code: shelterCode
							},
							limit: 100
						})
					})
				)
			);
			const expanded = memberResults.flatMap((result) => (result.docs ?? []).filter(isEvacueeDoc));
			const candidates = groups.map((candidate) => {
				const householdMembers = candidate.householdId
					? expanded.filter(
							(member) =>
								member.household_id === candidate.householdId && member.shelter_code === shelterCode
						)
					: [];
				const members = householdMembers.length > 0 ? householdMembers : [candidate.primary];
				const visibleMembers = members.filter(isListedHouseholdMember);
				return {
					primary_evacuee_id: candidate.primary._id,
					contact_display: [candidate.primary.first_name, maskLastName(candidate.primary.last_name)]
						.filter(Boolean)
						.join(' '),
					member_count: visibleMembers.length,
					pending_count: visibleMembers.filter(
						(member) =>
							member.registered_via === 'web' && member.current_stay?.status === 'pre_registered'
					).length
				};
			});
			return { kind: 'candidates', shelter_code: shelterCode, candidates };
		}
		group = groups[0];
	}

	if (!group) return { kind: 'not_found' };
	const primary = await getById(dbName, group.primary._id);
	if (!primary || !isPhoneMatchEligible(primary, shelterCode)) return { kind: 'not_found' };
	const members = (await expandHousehold(dbName, primary, shelterCode)).filter(
		isListedHouseholdMember
	);
	const matchedPhoneIds = new Set(group.matched.map((matched) => matched._id));
	return {
		kind: 'household',
		name_masked: true,
		shelter_code: shelterCode,
		primary_evacuee_id: primary._id,
		members: members.map((member) => toSummary(member, primary._id, { matchedPhoneIds }))
	};
}

/** Resolve a pre-registration or prior check-in only within the authenticated scanner's shelter. */
export async function lookupPreRegisteredEvacuee(
	shelterCode: string,
	input: z.infer<typeof kioskGateInputSchema>
): Promise<KioskLookupOutcome> {
	if (input.source === 'phone') {
		return lookupByPhone(shelterCode, input.phone, input.primary_evacuee_id);
	}

	const dbName = shelterDbName(shelterCode);
	let candidates: EvacueeDoc[];
	if (input.source === 'qr') {
		const docId = `evacuee:${input.token.slice('evacuee:'.length).toUpperCase()}`;
		const doc = await getById(dbName, docId);
		candidates = doc ? [doc] : [];
	} else {
		const result = await adminFetch<{ docs?: unknown[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'evacuee',
					'person_id.number': input.citizen_id,
					shelter_code: shelterCode
				},
				limit: 100
			})
		});
		candidates = (result.docs ?? []).filter(isEvacueeDoc);
	}

	const eligible = candidates.filter(
		(doc) =>
			doc.shelter_code === shelterCode &&
			doc.registered_via === 'web' &&
			doc.privacy?.search_excluded !== true &&
			(doc.current_stay?.status === 'pre_registered' ||
				isAlreadyCheckedInStatus(doc.current_stay?.status))
	);
	if (dev) {
		console.info('[Kiosk lookup] Match result', {
			candidate_count: candidates.length,
			eligible_count: eligible.length,
			outcome: eligible.length === 1 ? 'matched' : eligible.length === 0 ? 'no_match' : 'ambiguous'
		});
	}
	if (eligible.length !== 1) return { kind: 'not_found' };

	const primary = eligible[0];
	const members = await expandHousehold(dbName, primary, shelterCode);
	return {
		kind: 'household',
		name_masked: true,
		shelter_code: shelterCode,
		primary_evacuee_id: primary._id,
		members: members.filter(isListedHouseholdMember).map((member) => toSummary(member, primary._id))
	};
}

/** Report in selected household members independently; only committed writes get a QR token. */
export async function checkInSelectedMembers(
	shelterCode: string,
	primaryEvacueeId: string,
	evacueeIds: string[]
): Promise<KioskCheckInMemberResult[]> {
	const dbName = shelterDbName(shelterCode);
	const normalizedPrimaryId = `evacuee:${primaryEvacueeId.slice('evacuee:'.length).toUpperCase()}`;
	const normalizedEvacueeIds = evacueeIds.map(
		(id) => `evacuee:${id.slice('evacuee:'.length).toUpperCase()}`
	);
	const primary = await getById(dbName, normalizedPrimaryId);
	if (!primary || primary.shelter_code !== shelterCode || primary.registered_via !== 'web') {
		return normalizedEvacueeIds.map((evacueeId) => ({
			evacuee_id: evacueeId,
			status: 'not_eligible'
		}));
	}

	const uniqueIds = [...new Set(normalizedEvacueeIds)];
	const results: KioskCheckInMemberResult[] = [];
	for (const evacueeId of uniqueIds) {
		let member: EvacueeDoc | null;
		try {
			member = await getById(dbName, evacueeId);
		} catch {
			results.push({ evacuee_id: evacueeId, status: 'failed' });
			continue;
		}
		if (!member || member.shelter_code !== shelterCode) {
			results.push({ evacuee_id: evacueeId, status: 'not_found' });
			continue;
		}
		const belongsToHousehold =
			member._id === primary._id ||
			(Boolean(primary.household_id) && member.household_id === primary.household_id);
		if (!belongsToHousehold || member.registered_via !== 'web') {
			results.push({ evacuee_id: evacueeId, status: 'not_eligible' });
			continue;
		}
		if (member.current_stay?.status !== 'pre_registered') {
			const stayStatus = member.current_stay?.status ?? 'unknown';
			results.push({
				evacuee_id: evacueeId,
				status: isAlreadyCheckedInStatus(stayStatus) ? 'already_checked_in' : 'not_eligible',
				stay_status: stayStatus,
				...(stayStatus === 'arriving' ? { qr_payload: evacueeId } : {})
			});
			continue;
		}

		const timestamp = now();
		try {
			await adminFetch(`/${dbName}/${encodeURIComponent(member._id)}`, {
				method: 'PUT',
				body: JSON.stringify({
					...member,
					current_stay: {
						...member.current_stay,
						status: 'arriving',
						zone: null,
						since: timestamp
					},
					updated_at: timestamp
				})
			});
			results.push({
				evacuee_id: evacueeId,
				status: 'checked_in',
				stay_status: 'arriving',
				qr_payload: evacueeId
			});
		} catch {
			const latest = await getById(dbName, member._id).catch(() => null);
			if (latest && latest.current_stay?.status !== 'pre_registered') {
				const stayStatus = latest.current_stay?.status ?? 'unknown';
				results.push({
					evacuee_id: evacueeId,
					status: 'already_checked_in',
					stay_status: stayStatus,
					...(stayStatus === 'arriving' ? { qr_payload: evacueeId } : {})
				});
			} else {
				results.push({ evacuee_id: evacueeId, status: 'failed' });
			}
		}
	}
	if (primary.household_id && results.some((result) => result.status === 'checked_in')) {
		await refreshHouseholdStatus(dbName, primary.household_id, shelterCode);
	}
	return results;
}

/** Keep the legacy household status projection aligned with the member stay records. */
async function refreshHouseholdStatus(
	dbName: string,
	householdId: string,
	shelterCode: string
): Promise<void> {
	try {
		const [household, memberResult] = await Promise.all([
			adminFetch<{
				_id: string;
				_rev: string;
				type: string;
				status?: string;
				[key: string]: unknown;
			}>(`/${dbName}/${encodeURIComponent(householdId)}`),
			adminFetch<{ docs?: unknown[] }>(`/${dbName}/_find`, {
				method: 'POST',
				body: JSON.stringify({
					selector: { type: 'evacuee', household_id: householdId, shelter_code: shelterCode },
					limit: 100
				})
			})
		]);
		if (household.type !== 'household') return;
		const statuses = (memberResult.docs ?? [])
			.filter(isEvacueeDoc)
			.map((doc) => stayStatusSchema.safeParse(doc.current_stay?.status))
			.filter((parsed) => parsed.success)
			.map((parsed) => parsed.data);
		const status = deriveHouseholdStatus(statuses);
		if (status === household.status) return;
		await adminFetch(`/${dbName}/${encodeURIComponent(householdId)}`, {
			method: 'PUT',
			body: JSON.stringify({ ...household, status, updated_at: now() })
		});
	} catch {
		// The evacuee write is authoritative; a later read can repair this derived projection.
		console.warn('[Kiosk Check-in] Household status refresh failed');
	}
}
