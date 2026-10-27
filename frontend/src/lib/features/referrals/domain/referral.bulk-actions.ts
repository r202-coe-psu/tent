/**
 * Bulk / row actions for a referral and the same-status selection rules of the batch page
 * (CR-167, #563). Pure TypeScript — reuses the transition matrix and the actor helpers, so the UI
 * never hard-codes who may do what.
 */

import type { Referral, ReferralStatus } from './referral.schema';
import { canTransition } from './referral.transitions';
import { canActorRespond, isOutgoingCapacityReferral } from './referral.authorization';

export type ReferralActionKey =
	'send' | 'cancel_draft' | 'withdraw' | 'close' | 'accept' | 'reject';

export type ReferralActionMeta = {
	key: ReferralActionKey;
	/** Target status sent to the transition endpoint. */
	to: ReferralStatus;
	/** Verb label, e.g. "ส่ง". */
	label: string;
	/** Past-tense phrase for toasts, e.g. "ส่งตัว". */
	toastLabel: string;
	/** Whether the confirm dialog offers the optional reason field (everything except send). */
	asksReason: boolean;
	destructive: boolean;
};

export const REFERRAL_ACTIONS: Record<ReferralActionKey, ReferralActionMeta> = {
	send: {
		key: 'send',
		to: 'sent',
		label: 'ส่ง',
		toastLabel: 'ส่งตัว',
		asksReason: false,
		destructive: false
	},
	cancel_draft: {
		key: 'cancel_draft',
		to: 'closed',
		label: 'ยกเลิกร่าง',
		toastLabel: 'ยกเลิกร่าง',
		asksReason: true,
		destructive: true
	},
	withdraw: {
		key: 'withdraw',
		to: 'closed',
		label: 'ถอนคำขอ',
		toastLabel: 'ถอนคำขอ',
		asksReason: true,
		destructive: true
	},
	close: {
		key: 'close',
		to: 'closed',
		label: 'ปิดรายการ',
		toastLabel: 'ปิดรายการ',
		asksReason: true,
		destructive: true
	},
	accept: {
		key: 'accept',
		to: 'accepted',
		label: 'ตอบรับ',
		toastLabel: 'ตอบรับ',
		asksReason: true,
		destructive: false
	},
	reject: {
		key: 'reject',
		to: 'rejected',
		label: 'ปฏิเสธ',
		toastLabel: 'ปฏิเสธ',
		asksReason: true,
		destructive: true
	}
};

/** Display order of the action buttons. */
const ACTION_ORDER: readonly ReferralActionKey[] = [
	'send',
	'accept',
	'reject',
	'cancel_draft',
	'withdraw',
	'close'
];

/** Max length of the optional reason typed in the confirm dialog (matches the server schema). */
export const REFERRAL_REASON_MAX_LENGTH = 2000;

/** Source side may close; for a capacity referral only the originating shelter, never the destination. */
function mayClose(referral: Referral, actorShelter: string): boolean {
	return (
		referral.referral_type !== 'capacity' || isOutgoingCapacityReferral(referral, actorShelter)
	);
}

/** Actions `actorShelter` can take on this referral right now (empty when none). */
export function getReferralActions(referral: Referral, actorShelter: string): ReferralActionKey[] {
	const { status } = referral;
	const keys: ReferralActionKey[] = [];
	if (canTransition(status, 'sent') && mayClose(referral, actorShelter)) keys.push('send');
	if (canActorRespond(referral, actorShelter)) {
		if (canTransition(status, 'accepted')) keys.push('accept');
		if (canTransition(status, 'rejected')) keys.push('reject');
	}
	if (canTransition(status, 'closed') && mayClose(referral, actorShelter)) {
		if (status === 'draft') keys.push('cancel_draft');
		else if (status === 'sent') keys.push('withdraw');
		else keys.push('close');
	}
	return ACTION_ORDER.filter((key) => keys.includes(key));
}

/** Whether the referral has any action, i.e. it may get a checkbox. */
export function isReferralActionable(referral: Referral, actorShelter: string): boolean {
	return getReferralActions(referral, actorShelter).length > 0;
}

/** Why a row's checkbox is unavailable, or `null` when it can be (de)selected. */
export type RowSelectability = 'selectable' | 'no-actions' | 'other-status';

/**
 * Selection rule: only referrals with an action get a checkbox, and only one status at a time.
 * `selectedStatus` is the status of the current selection (`null` when nothing is selected).
 */
export function getRowSelectability(
	referral: Referral,
	selectedStatus: ReferralStatus | null,
	actorShelter: string
): RowSelectability {
	if (!isReferralActionable(referral, actorShelter)) return 'no-actions';
	if (selectedStatus !== null && referral.status !== selectedStatus) return 'other-status';
	return 'selectable';
}

/**
 * Status "select all" acts on: the current selection's status, or the first actionable status in
 * list order when nothing is selected.
 */
export function getSelectAllStatus(
	members: Referral[],
	selectedStatus: ReferralStatus | null,
	actorShelter: string
): ReferralStatus | null {
	if (selectedStatus !== null) return selectedStatus;
	return members.find((r) => isReferralActionable(r, actorShelter))?.status ?? null;
}

/** Ids "select all" selects: members of {@link getSelectAllStatus} that may be selected. */
export function getSelectAllIds(
	members: Referral[],
	selectedStatus: ReferralStatus | null,
	actorShelter: string
): string[] {
	const status = getSelectAllStatus(members, selectedStatus, actorShelter);
	if (status === null) return [];
	return members
		.filter((r) => r.status === status && isReferralActionable(r, actorShelter))
		.map((r) => r._id);
}

/** Actions every selected referral supports, in display order (the sticky bar's buttons). */
export function getCommonActions(selected: Referral[], actorShelter: string): ReferralActionMeta[] {
	if (selected.length === 0) return [];
	const lists = selected.map((r) => getReferralActions(r, actorShelter));
	return ACTION_ORDER.filter((key) => lists.every((list) => list.includes(key))).map(
		(key) => REFERRAL_ACTIONS[key]
	);
}
