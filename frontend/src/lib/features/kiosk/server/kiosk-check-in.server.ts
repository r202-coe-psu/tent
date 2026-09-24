import { dev } from '$app/environment';
import { z } from 'zod';
import { now } from '$lib/db/model';
import { deriveHouseholdStatus, stayStatusSchema } from '$lib/features/people/domain/people';
import { isAlreadyCheckedInStatus } from '../domain/check-in-status';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';

const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';

export const kioskGateInputSchema = z.discriminatedUnion('source', [
	z.object({ source: z.literal('smart-card'), citizen_id: z.string().regex(/^\d{13}$/) }),
	z.object({
		source: z.literal('qr'),
		token: z.string().regex(new RegExp(`^evacuee:${ULID}$`, 'i'))
	})
]);

export const kioskCheckInInputSchema = z.object({
	primary_evacuee_id: z.string().regex(new RegExp(`^evacuee:${ULID}$`, 'i')),
	evacuee_ids: z
		.array(z.string().regex(new RegExp(`^evacuee:${ULID}$`, 'i')))
		.min(1)
		.max(20)
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
	selectable: boolean;
}

export interface KioskLookupResult {
	shelter_code: string;
	primary_evacuee_id: string;
	members: KioskEvacueeSummary[];
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

function toSummary(doc: EvacueeDoc, primaryId: string): KioskEvacueeSummary {
	const status = doc.current_stay?.status ?? 'unknown';
	return {
		evacuee_id: doc._id,
		first_name: doc.first_name ?? '',
		last_name: doc.last_name ?? '',
		gender: doc.gender ?? null,
		age: typeof doc.age === 'number' ? doc.age : null,
		status,
		is_primary: doc._id === primaryId,
		selectable: doc.registered_via === 'web' && status === 'pre_registered'
	};
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

/** Resolve a pre-registration or prior check-in only within the authenticated scanner's shelter. */
export async function lookupPreRegisteredEvacuee(
	shelterCode: string,
	input: z.infer<typeof kioskGateInputSchema>
): Promise<KioskLookupResult | null> {
	const dbName = shelterDbName(shelterCode);
	let candidates: EvacueeDoc[];

	if (input.source === 'qr') {
		const docId = `evacuee:${input.token.slice('evacuee:'.length).toUpperCase()}`;
		if (dev) {
			console.info('[Kiosk lookup] CouchDB query', {
				gate: input.source,
				database: dbName,
				document_id_suffix: docId.slice(-4),
				eligibility: {
					type: 'evacuee',
					shelter_code: shelterCode,
					registered_via: 'web',
					current_stay_status: [
						'pre_registered',
						'arriving',
						'active',
						'room_confirmed',
						'temporary_leave'
					]
				}
			});
		}
		const doc = await getById(dbName, docId);
		candidates = doc ? [doc] : [];
	} else {
		if (dev) {
			console.info('[Kiosk lookup] CouchDB query', {
				gate: input.source,
				database: dbName,
				method: '_find',
				selector: {
					type: 'evacuee',
					'person_id.number': `•••••••••${input.citizen_id.slice(-4)}`,
					shelter_code: shelterCode
				},
				post_filter: {
					registered_via: 'web',
					'current_stay.status': [
						'pre_registered',
						'arriving',
						'active',
						'room_confirmed',
						'temporary_leave'
					]
				},
				limit: 100
			});
		}
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
	if (eligible.length !== 1) return null;

	const primary = eligible[0];
	const members: EvacueeDoc[] = [primary];
	if (primary.household_id) {
		const householdResult = await adminFetch<{ docs?: unknown[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'evacuee',
					household_id: primary.household_id,
					shelter_code: shelterCode,
					registered_via: 'web'
				},
				limit: 100
			})
		});
		for (const doc of (householdResult.docs ?? []).filter(isEvacueeDoc)) {
			if (
				doc._id !== primary._id &&
				doc.shelter_code === shelterCode &&
				doc.household_id === primary.household_id
			) {
				members.push(doc);
			}
		}
	}

	return {
		shelter_code: shelterCode,
		primary_evacuee_id: primary._id,
		members: members.map((member) => toSummary(member, primary._id))
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
