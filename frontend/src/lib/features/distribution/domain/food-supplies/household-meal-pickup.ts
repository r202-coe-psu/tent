import { IN_SHELTER_STATUSES } from '$lib/features/shared';
import { isDuplicateMealDistributionLog, type DistributionLog } from './distribution-log';
import type { MealPeriod } from './shared';

export interface HouseholdPickupMember {
	_id: string;
	current_stay?: { status?: string | null } | null;
}

/**
 * Who can collect a meal at the desk (CR-240 R2): everyone in the shelter, plus people
 * still waiting to be admitted — registered at the kiosk or arriving — who eat here too.
 * Wider than `IN_SHELTER_STATUSES` on purpose; headcounts keep using that definition.
 */
export const MEAL_PICKUP_STAY_STATUSES = [
	...IN_SHELTER_STATUSES,
	'kiosk_registered',
	'arriving'
] as const;

/** Stays that are not yet admitted but may still collect a meal. */
export const AWAITING_ADMISSION_STAY_STATUSES = ['kiosk_registered', 'arriving'] as const;

export function isMealPickupStayStatus(status: string | null | undefined): boolean {
	return (MEAL_PICKUP_STAY_STATUSES as readonly string[]).includes(status ?? '');
}

export function isAwaitingAdmissionStayStatus(status: string | null | undefined): boolean {
	return (AWAITING_ADMISSION_STAY_STATUSES as readonly string[]).includes(status ?? '');
}

const BLOCK_REASONS: Record<string, string> = {
	pre_registered: 'ลงทะเบียนล่วงหน้า ยังไม่มารายงานตัวที่ศูนย์',
	temporary_leave: 'ออกจากศูนย์ชั่วคราว',
	transferred: 'ย้ายไปศูนย์อื่นแล้ว',
	checked_out: 'เช็คเอาต์ออกจากศูนย์แล้ว',
	deceased: 'เสียชีวิต',
	cancelled: 'ยกเลิกการลงทะเบียนแล้ว'
};

/** Why this stay may not collect a meal at the desk, or `null` when it may. */
export function mealPickupBlockReason(status: string | null | undefined): string | null {
	if (isMealPickupStayStatus(status)) return null;
	return (status && BLOCK_REASONS[status]) || 'ยังไม่มีข้อมูลการเข้าพักในศูนย์';
}

export type HouseholdMealPickupBlock = { evacuee_id: string; reason: string };

/** Household members left out of the pickup list, with the reason shown to the desk. */
export function householdMealPickupBlocks(
	members: readonly HouseholdPickupMember[]
): HouseholdMealPickupBlock[] {
	return members.flatMap((m) => {
		const reason = mealPickupBlockReason(m.current_stay?.status);
		return reason ? [{ evacuee_id: m._id, reason }] : [];
	});
}

export type HouseholdPickupLog = Pick<
	DistributionLog,
	'recipient_id' | 'meal' | 'status' | 'is_returnable' | 'distributed_at'
>;

export type HouseholdMemberMealStatus =
	| { evacuee_id: string; status: 'eligible' }
	| { evacuee_id: string; status: 'already_received'; last_distributed_at: string };

/**
 * Which household members who may eat here (in the shelter or awaiting admission) may still collect `meal` on the Thailand day of `at`
 * (#1154 R2/R4/R5). Members outside the shelter are left out; the rest keep input order.
 */
export function evaluateHouseholdMealPickup(input: {
	members: readonly HouseholdPickupMember[];
	logs: readonly HouseholdPickupLog[];
	meal: MealPeriod;
	at: string;
}): HouseholdMemberMealStatus[] {
	return input.members
		.filter((m) => isMealPickupStayStatus(m.current_stay?.status))
		.map((m) => {
			const received = input.logs
				.filter(
					(log) =>
						log.recipient_id === m._id && isDuplicateMealDistributionLog(log, input.meal, input.at)
				)
				.map((log) => log.distributed_at)
				.sort();
			const last = received.at(-1);
			return last
				? { evacuee_id: m._id, status: 'already_received', last_distributed_at: last }
				: { evacuee_id: m._id, status: 'eligible' };
		});
}
