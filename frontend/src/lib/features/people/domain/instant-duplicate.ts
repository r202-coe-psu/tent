import {
	isAnonymousId,
	formatPersonName,
	STATUS_LABELS,
	type Evacuee,
	type StayStatus
} from './people';
import {
	formatOpenMemberName,
	type UnassignedRegistrationSearchHit
} from '$lib/features/unassigned-registration';
import { peopleRepository } from '../data/people.remote';
import { unassignedRegistrationRemote } from '$lib/features/unassigned-registration/data/unassigned-registration.remote';

/** Check if card number qualifies as a 13-digit Thai National ID candidate. */
export function isValidThaiIdCandidate(
	number: string | null | undefined,
	cardType?: string | null
): boolean {
	if (!number) return false;
	const trimmed = number.trim();
	if (!trimmed) return false;
	// Exclude anonymous IDs like ANON-*
	if (isAnonymousId(trimmed)) return false;
	// Must be national_id or unspecified (defaults to national_id)
	if (cardType && cardType !== 'national_id') return false;
	const digitsOnly = trimmed.replace(/\D/g, '');
	return digitsOnly.length === 13;
}

export interface InstantDuplicateMatch {
	source: 'local' | 'unassigned';
	id: string;
	name: string;
	nationalId: string;
	status: string;
	statusLabel: string;
	actionUrl: string;
	actionLabel: string;
	shelterLabel?: string;
	rawHit?: Evacuee | UnassignedRegistrationSearchHit;
}

export interface FederatedDuplicateLookupDeps {
	searchLocal: (query: string) => Promise<Map<string, Evacuee[]>>;
	searchPool: (query: string) => Promise<{ results: UnassignedRegistrationSearchHit[] }>;
}

/**
 * Pure helper to resolve the destination URL and action label for a duplicate hit.
 */
export function resolveInstantDuplicateAction(match: {
	source: 'local' | 'unassigned';
	id: string;
	status?: string;
	memberIds?: string[];
}): { actionUrl: string; actionLabel: string } {
	if (match.source === 'local') {
		if (match.status === 'pre_registered') {
			return {
				actionUrl: `/onsite/people/${match.id}/report-in`,
				actionLabel: 'ไปที่ข้อมูลเดิม / เช็คอิน'
			};
		}
		return {
			actionUrl: `/onsite/people/evacuee-profile-view/${match.id}`,
			actionLabel: 'ไปที่ข้อมูลเดิม / เช็คอิน'
		};
	}
	const memberParam = match.memberIds?.length ? `?memberIds=${match.memberIds.join(',')}` : '';
	return {
		actionUrl: `/onsite/unassigned/${match.id}/report-in${memberParam}`,
		actionLabel: 'ไปที่ข้อมูลเดิม / เช็คอิน'
	};
}

/**
 * Concurrent federated duplicate lookup across local shelter (CouchDB)
 * and central unassigned pool (MongoDB). Gracefully handles network/rejection errors.
 */
export async function performFederatedDuplicateLookup(
	thaiId: string,
	deps?: FederatedDuplicateLookupDeps
): Promise<InstantDuplicateMatch[]> {
	const digitsOnly = thaiId.trim().replace(/\D/g, '');
	if (digitsOnly.length !== 13) return [];

	const searchLocal =
		deps?.searchLocal ?? ((id: string) => peopleRepository().searchEvacueesMany([id]));
	const searchPool =
		deps?.searchPool ?? ((id: string) => unassignedRegistrationRemote.searchOpen(id));

	const [localRes, poolRes] = await Promise.allSettled([
		searchLocal(digitsOnly),
		searchPool(digitsOnly)
	]);

	const matches: InstantDuplicateMatch[] = [];

	if (localRes.status === 'fulfilled') {
		const localHits = localRes.value.get(digitsOnly) ?? [];
		for (const evacuee of localHits) {
			const status = evacuee.current_stay?.status ?? 'active';
			const rawStatusLabel = STATUS_LABELS[status as StayStatus] ?? status;
			const { actionUrl, actionLabel } = resolveInstantDuplicateAction({
				source: 'local',
				id: evacuee._id,
				status
			});

			matches.push({
				source: 'local',
				id: evacuee._id,
				name: formatPersonName(evacuee),
				nationalId: evacuee.person_id?.number ?? digitsOnly,
				status,
				statusLabel: `ในศูนย์พักพิง — ${rawStatusLabel}`,
				shelterLabel: 'ในศูนย์นี้',
				actionUrl,
				actionLabel,
				rawHit: evacuee
			});
		}
	}

	if (poolRes.status === 'fulfilled') {
		const poolHits = poolRes.value.results ?? [];
		for (const hit of poolHits) {
			const matchingMember =
				hit.open_members.find((m) => {
					const num = m.person_id?.number?.replace(/\D/g, '') ?? '';
					return num === digitsOnly;
				}) ?? hit.open_members[0];

			if (matchingMember) {
				const memberIds = hit.open_members.map((m) => m.reserved_evacuee_id);
				const { actionUrl, actionLabel } = resolveInstantDuplicateAction({
					source: 'unassigned',
					id: hit.id,
					status: 'unassigned_open',
					memberIds
				});

				matches.push({
					source: 'unassigned',
					id: hit.id,
					name: formatOpenMemberName(matchingMember),
					nationalId: matchingMember.person_id?.number ?? digitsOnly,
					status: 'unassigned_open',
					statusLabel: 'คิวกลาง — ลงทะเบียนออนไลน์',
					shelterLabel: 'คิวกลาง',
					actionUrl,
					actionLabel,
					rawHit: hit
				});
			}
		}
	}

	return matches;
}
