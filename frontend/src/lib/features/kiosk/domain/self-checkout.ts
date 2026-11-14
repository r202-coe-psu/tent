import {
	CHECK_OUT_ELIGIBLE_STATUSES,
	type CheckoutDestination
} from '$lib/features/people/domain/people';
import type { LanguageCode } from '$lib/utils/language';

/** Where the kiosk lets a visitor say they are going (#1401). Shelter-to-shelter needs staff. */
export const KIOSK_CHECKOUT_DESTINATIONS = ['returned_home', 'other'] as const;
export type KioskCheckoutDestination = (typeof KIOSK_CHECKOUT_DESTINATIONS)[number];

/** Notes the kiosk writes for an `other` destination: R-29-8 requires them, the visitor gives none. */
const KIOSK_OTHER_DESTINATION_NOTES = 'เช็คเอาต์ที่ตู้ kiosk';

/** Stay statuses that can check themselves out at the kiosk (same guard as staff check-out). */
export function isSelfCheckoutEligible(status: string | null | undefined): boolean {
	return CHECK_OUT_ELIGIBLE_STATUSES.some((candidate) => candidate === status);
}

/**
 * Whether the kiosk asks "check out?" before the usual flow: a card or ThaiD scan (never a QR /
 * phone lookup) whose holder is already in the shelter. `source` is a `GateInput['source']`; it is
 * a plain string so the domain layer does not depend on the data layer.
 */
export function shouldOfferSelfCheckout(
	source: string,
	members: readonly { is_primary: boolean; status: string }[]
): boolean {
	if (source !== 'smart-card' && source !== 'thaid') return false;
	const holder = members.find((member) => member.is_primary);
	return holder !== undefined && isSelfCheckoutEligible(holder.status);
}

const UNAVAILABLE_REASONS: Record<string, Record<LanguageCode, string>> = {
	arriving: {
		th: 'ยังไม่ผ่านจุดจัดโซน — ติดต่อเจ้าหน้าที่',
		en: 'Not zoned yet — please contact staff'
	},
	temporary_leave: {
		th: 'ออกนอกศูนย์ชั่วคราว — ติดต่อเจ้าหน้าที่',
		en: 'Temporarily away — please contact staff'
	},
	pre_registered: { th: 'ยังไม่ได้รายงานตัว', en: 'Not checked in yet' }
};

const GENERIC_UNAVAILABLE_REASON: Record<LanguageCode, string> = {
	th: 'ติดต่อเจ้าหน้าที่',
	en: 'Please contact staff'
};

/** Why a listed member is greyed out on the check-out screen; null when they can be picked. */
export function selfCheckoutUnavailableReason(
	status: string,
	language: LanguageCode
): string | null {
	if (isSelfCheckoutEligible(status)) return null;
	return (UNAVAILABLE_REASONS[status] ?? GENERIC_UNAVAILABLE_REASON)[language];
}

/** Ticked by default: the card holder, when they can check out. */
export function initialCheckoutSelection(
	members: readonly { evacuee_id: string; is_primary: boolean; status: string }[]
): string[] {
	return members
		.filter((member) => member.is_primary && isSelfCheckoutEligible(member.status))
		.map((member) => member.evacuee_id);
}

/** Movement `reason` for a kiosk check-out; names the machine so the audit trail can find it. */
export function kioskCheckoutReason(deviceLabel: string): string {
	return `เช็คเอาต์ด้วยตนเองที่ตู้ kiosk (${deviceLabel})`;
}

/** Household `checkout_destination` that satisfies R-29-8 for what the kiosk collects. */
export function kioskCheckoutDestination(type: KioskCheckoutDestination): CheckoutDestination {
	return type === 'other' ? { type, notes: KIOSK_OTHER_DESTINATION_NOTES } : { type };
}
