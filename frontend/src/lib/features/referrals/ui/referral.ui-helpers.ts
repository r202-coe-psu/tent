import {
	type Referral,
	type ReferralDirectionFilter,
	type ReferralStatus,
	type ReferralType,
	type ReferralUrgency
} from '../domain/referral.schema';
import { getShelterCode } from '$lib/db/shelter';
import { formatThaiDateTime } from '$lib/utils/date';

export function getStatusLabel(status: ReferralStatus, options?: { verbose?: boolean }): string {
	const labels: Record<ReferralStatus, { short: string; verbose: string }> = {
		draft: { short: 'ฉบับร่าง', verbose: 'ฉบับร่าง (Draft)' },
		sent: { short: 'ส่งตัวแล้ว', verbose: 'ส่งตัวแล้ว (Sent)' },
		accepted: { short: 'ตอบรับแล้ว', verbose: 'ตอบรับการส่งต่อแล้ว (Accepted)' },
		rejected: { short: 'ปฏิเสธรับ', verbose: 'ปฏิเสธรับการส่งต่อ (Rejected)' },
		closed: { short: 'ปิดการส่งตัว', verbose: 'ปิดการส่งตัวแล้ว (Closed)' }
	};
	return options?.verbose ? labels[status].verbose : labels[status].short;
}

/**
 * Derived sub-label for a `closed` referral (CR-167 FR-W4/W5). Never stored on the doc.
 * - closed with `timeline.sent` and no `timeline.responded` → withdrawn ("ถอนคำขอ", or
 *   "ถูกถอนโดยศูนย์ต้นทาง" when `viewer` is the destination shelter)
 * - closed without `timeline.sent` → cancelled draft ("ยกเลิกร่าง")
 * - any other closed referral (responded) or non-closed status → null (plain "closed")
 */
export function getClosedSubLabel(
	referral: Pick<Referral, 'status' | 'timeline'>,
	viewer: 'source' | 'destination' = 'source'
): string | null {
	if (referral.status !== 'closed') return null;
	const { sent, responded } = referral.timeline ?? {};
	if (!sent) return 'ยกเลิกร่าง';
	if (responded) return null;
	return viewer === 'destination' ? 'ถูกถอนโดยศูนย์ต้นทาง' : 'ถอนคำขอ';
}

export function getStatusBadgeVariant(status: ReferralStatus): string {
	switch (status) {
		case 'draft':
			return 'bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-950/20 dark:text-orange-400';
		case 'sent':
			return 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-950/20 dark:text-blue-400';
		case 'accepted':
			return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400';
		case 'rejected':
			return 'bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-950/20 dark:text-rose-400';
		case 'closed':
			return 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800/40 dark:text-slate-400';
	}
}

export function getUrgencyStyle(urgency: ReferralUrgency | string): string {
	if (urgency === 'urgent') {
		return 'bg-red-500 hover:bg-red-600 text-white motion-safe:animate-pulse';
	}
	return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
}

export function getUrgencyLabel(urgency: ReferralUrgency | string): string {
	return urgency === 'urgent' ? 'ด่วนมาก' : 'ปกติ';
}

export function getKindLabel(type?: ReferralType | string, options?: { short?: boolean }): string {
	if (options?.short) {
		switch (type) {
			case 'capacity':
				return 'ย้ายศูนย์';
			case 'resource':
				return 'ขอสิ่งของ';
			case 'medical-emergency':
			default:
				return 'พยาบาล';
		}
	}

	switch (type) {
		case 'capacity':
			return 'ย้ายศูนย์พักพิง (Capacity Transfer)';
		case 'resource':
			return 'ขอสนับสนุนทรัพยากร (Resource Request)';
		case 'medical-emergency':
		default:
			return 'การรักษาพยาบาล (Medical Emergency)';
	}
}

export function formatReferralDate(isoString?: string | null): string {
	if (!isoString) return '-';
	return formatThaiDateTime(isoString) || isoString;
}

/** List badge: incoming capacity referral targeting this shelter. */
export function isIncomingListItem(
	referral: { referral_type?: string; shelter_code: string; to_shelter_code?: string },
	actorShelter: string
): boolean {
	return (
		referral.referral_type === 'capacity' &&
		!!referral.to_shelter_code &&
		referral.to_shelter_code.toUpperCase() === actorShelter.toUpperCase() &&
		referral.shelter_code.toUpperCase() !== actorShelter.toUpperCase()
	);
}

/**
 * Determines the cross-shelter direction of a capacity referral relative to the active shelter:
 * - `outgoing`: Referral created by current shelter targeting another shelter (`shelter_code === actorShelter`)
 * - `incoming`: Referral created by another shelter targeting current shelter (`to_shelter_code === actorShelter`)
 * - `internal`: Non-capacity referral or referral within the same shelter scope
 */
export function getReferralDirection(referral: Referral): 'outgoing' | 'incoming' | 'internal' {
	const currentShelter = getShelterCode();
	if (referral.referral_type !== 'capacity') return 'internal';
	if (referral.shelter_code === currentShelter && referral.to_shelter_code) return 'outgoing';
	if (referral.to_shelter_code === currentShelter) return 'incoming';
	return 'internal';
}

/**
 * Returns human-readable Thai label for cross-shelter direction badge:
 * - `outgoing` → 'ขาออก'
 * - `incoming` → 'ขาเข้า'
 * - `internal` → 'ภายใน'
 */
export function getDirectionLabel(direction: 'outgoing' | 'incoming' | 'internal'): string {
	const labels = { outgoing: 'ขาออก', incoming: 'ขาเข้า', internal: 'ภายใน' };
	return labels[direction];
}

/**
 * Returns Tailwind CSS styling variant classes for cross-shelter direction badge:
 * - `outgoing`: Blue badge style
 * - `incoming`: Green badge style
 * - `internal`: Neutral gray badge style
 */
export function getDirectionBadgeVariant(direction: 'outgoing' | 'incoming' | 'internal'): string {
	const variants = {
		outgoing: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300',
		incoming:
			'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300',
		internal: 'bg-gray-100 text-gray-600 border-gray-200'
	};
	return variants[direction];
}

/** Shown when neither the evacuee roster nor the referral's name summary has a name. */
export const EVACUEE_NAME_FALLBACK = 'ไม่พบชื่อผู้เข้าพัก';

/**
 * Display name for an evacuee. The first source with a name wins (e.g. roster row, then the
 * referral's `evacuee_summary`); if none has one, returns EVACUEE_NAME_FALLBACK.
 */
export function resolveEvacueeName(
	...sources: ({ first_name: string; last_name: string } | null | undefined)[]
): string {
	const found = sources.find((source) => !!source);
	return found ? formatEvacueeFullName(found) : EVACUEE_NAME_FALLBACK;
}

/** "first last"; an empty or blank last_name (mononym) is omitted, leaving no trailing space. */
export function formatEvacueeFullName(person: { first_name: string; last_name?: string | null }) {
	return [person.first_name, person.last_name ?? '']
		.map((part) => part.trim())
		.filter(Boolean)
		.join(' ');
}

/** Max names listed in a referral confirm dialog before the rest is summarised as "และอีก N คน". */
export const REFERRAL_CONFIRM_NAME_LIMIT = 5;

/**
 * Names line for a referral confirm dialog: the first `limit` names joined by ", ", then
 * " และอีก N คน" for the remainder. Returns '' for an empty list.
 */
export function formatReferralNameSummary(
	names: readonly string[],
	limit: number = REFERRAL_CONFIRM_NAME_LIMIT
): string {
	if (names.length === 0) return '';
	const shown = names.slice(0, limit).join(', ');
	const remaining = names.length - limit;
	return remaining > 0 ? `${shown} และอีก ${remaining} คน` : shown;
}

/**
 * Validation message for the evacuee picker on the create-referral form.
 * Returns undefined when at least one evacuee is selected.
 */
export function getEvacueeSelectionError(selectedIds: readonly string[]): string | undefined {
	return selectedIds.length === 0 ? 'กรุณาเลือกผู้เข้าพักอย่างน้อย 1 คน' : undefined;
}

/**
 * Whether a keydown on a selectable list row should activate it (Enter or Space).
 * `isOwnTarget` must be true only when the event target is the row itself, so keys pressed on a
 * nested control (e.g. an action button inside the row) do not also select the row.
 */
export function isRowActivationKey(event: { key: string; isOwnTarget: boolean }): boolean {
	return event.isOwnTarget && (event.key === 'Enter' || event.key === ' ');
}

// ---------------------------------------------------------------------------
// Route paths and list URL params (`dir`, `status`, `q`)
// ---------------------------------------------------------------------------

export const REFERRALS_PATH = '/back-office/referrals';

/** Detail page of one referral. Ids contain `:`, so they are always encoded. */
export function referralDetailPath(id: string): string {
	return `${REFERRALS_PATH}/${encodeURIComponent(id)}`;
}

/** Batch members page of the batch the referral belongs to. */
export function referralBatchPath(id: string): string {
	return `${referralDetailPath(id)}/batch`;
}

export type ReferralListParams = {
	direction: ReferralDirectionFilter;
	status: 'all' | ReferralStatus;
	q: string;
};

const LIST_STATUSES: readonly string[] = ['draft', 'sent', 'accepted', 'rejected', 'closed'];

/** Read list state from the URL; unknown values fall back to the defaults (`out`, all, empty). */
export function parseReferralListParams(params: URLSearchParams): ReferralListParams {
	const status = params.get('status') ?? '';
	return {
		direction: params.get('dir') === 'in' ? 'incoming' : 'outgoing',
		status: LIST_STATUSES.includes(status) ? (status as ReferralStatus) : 'all',
		q: params.get('q') ?? ''
	};
}

/** List URL for the given state; defaults are omitted so the plain list URL stays clean. */
export function buildReferralListHref(state: Partial<ReferralListParams>): string {
	const qs = new URLSearchParams();
	if (state.direction === 'incoming') qs.set('dir', 'in');
	if (state.status && state.status !== 'all') qs.set('status', state.status);
	const q = state.q?.trim();
	if (q) qs.set('q', q);
	const text = qs.toString();
	return text ? `${REFERRALS_PATH}?${text}` : REFERRALS_PATH;
}
