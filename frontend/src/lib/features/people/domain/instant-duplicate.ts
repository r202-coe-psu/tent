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

/** Check if phone number qualifies as a Thai phone candidate (9-10 digits, starts with 0). */
export function isValidPhoneCandidate(phone: string | null | undefined): boolean {
	if (!phone) return false;
	const trimmed = phone.trim();
	if (!trimmed) return false;
	const digitsOnly = trimmed.replace(/\D/g, '');
	return (digitsOnly.length === 9 || digitsOnly.length === 10) && digitsOnly.startsWith('0');
}

export interface InstantDuplicateMatch {
	source: 'local' | 'unassigned';
	id: string;
	name: string;
	nationalId?: string;
	phone?: string;
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
	query: string,
	deps?: FederatedDuplicateLookupDeps
): Promise<InstantDuplicateMatch[]> {
	const digitsOnly = query.trim().replace(/\D/g, '');
	if (digitsOnly.length !== 13 && digitsOnly.length !== 10 && digitsOnly.length !== 9) return [];

	const searchLocal =
		deps?.searchLocal ?? ((q: string) => peopleRepository().searchEvacueesMany([q]));
	const searchPool =
		deps?.searchPool ?? ((q: string) => unassignedRegistrationRemote.searchOpen(q));

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
				nationalId: evacuee.person_id?.number,
				phone: evacuee.phone ?? undefined,
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
					const phone = (m.phone ?? '').replace(/\D/g, '');
					return num === digitsOnly || phone === digitsOnly;
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
					nationalId: matchingMember.person_id?.number ?? undefined,
					phone: matchingMember.phone ?? undefined,
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

export interface PublicDuplicateCheckResult {
	duplicate: boolean;
	field: 'national_id' | 'phone' | null;
}

/**
 * Public rate-limited duplicate check via server-side endpoint.
 * Completely zero-PII guarantee (returns only boolean duplicate status).
 */
export async function checkPublicDuplicate(
	params: { national_id?: string; phone?: string },
	fetchFn: typeof fetch = fetch
): Promise<PublicDuplicateCheckResult> {
	try {
		const res = await fetchFn('/api/public/v1/registrations/check-duplicate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params)
		});

		if (!res.ok) {
			return { duplicate: false, field: null };
		}

		const data = (await res.json().catch(() => null)) as {
			success?: boolean;
			duplicate?: boolean;
			field?: 'national_id' | 'phone' | null;
		} | null;

		return {
			duplicate: Boolean(data?.duplicate),
			field: data?.field ?? null
		};
	} catch {
		return { duplicate: false, field: null };
	}
}
