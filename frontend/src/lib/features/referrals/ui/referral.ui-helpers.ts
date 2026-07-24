import type {
	Referral,
	ReferralStatus,
	ReferralType,
	ReferralUrgency
} from '../domain/referral.schema';
import { getShelterCode } from '$lib/db/shelter';

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
	try {
		const d = new Date(isoString);
		if (isNaN(d.getTime())) return isoString;
		return d.toLocaleString('th-TH', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	} catch {
		return isoString;
	}
}

/** List badge: incoming capacity mirror targeting this shelter. */
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
