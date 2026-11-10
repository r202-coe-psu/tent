import { isInShelterStayStatus } from '$lib/features/shared';
import { isDuplicateMealDistributionLog, type DistributionLog } from './distribution-log';
import type { MealPeriod } from './shared';

export interface HouseholdPickupMember {
	_id: string;
	current_stay?: { status?: string | null } | null;
}

export type HouseholdPickupLog = Pick<
	DistributionLog,
	'recipient_id' | 'meal' | 'status' | 'is_returnable' | 'distributed_at'
>;

export type HouseholdMemberMealStatus =
	| { evacuee_id: string; status: 'eligible' }
	| { evacuee_id: string; status: 'already_received'; last_distributed_at: string };

/**
 * Which in-shelter household members may still collect `meal` on the Thailand day of `at`
 * (#1154 R2/R4/R5). Members outside the shelter are left out; the rest keep input order.
 */
export function evaluateHouseholdMealPickup(input: {
	members: readonly HouseholdPickupMember[];
	logs: readonly HouseholdPickupLog[];
	meal: MealPeriod;
	at: string;
}): HouseholdMemberMealStatus[] {
	return input.members
		.filter((m) => isInShelterStayStatus(m.current_stay?.status))
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
