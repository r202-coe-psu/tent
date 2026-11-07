import type { AuthorContext } from '$lib/db/model';
import { isInShelterStayStatus } from '$lib/features/shared';
import { peopleRepository } from '$lib/features/people';
import type { DistributionLog, HouseholdPickupMember } from '../../domain/food-supplies';
import { assertCanPerformFrontlineDistribution } from './auth';
import { WorkflowValidationError } from './errors';
import {
	recordFoodDistribution,
	type DistributionWorkflowDependencies,
	type FoodDistributionInput
} from './distribution-workflow';

export interface HouseholdMealSelection {
	evacuee_id: string;
	/** Required for a member who already received this meal (or fails a menu/allergy check). */
	override_reason?: string;
	menu_check?: FoodDistributionInput['menu_check'];
	allergen_check?: FoodDistributionInput['allergen_check'];
}

export interface HouseholdMealPickupInput {
	item_id: string;
	household_id: string;
	/** The member standing at the desk; may be anyone in the household. */
	collector_id: string;
	selections: readonly HouseholdMealSelection[];
	meal_service_id?: string;
	recipe_id?: string;
	notes?: string;
}

export type HouseholdMealPickupResult =
	| { evacuee_id: string; ok: true; log: DistributionLog }
	| { evacuee_id: string; ok: false; error: unknown };

export interface HouseholdMealPickupDependencies extends DistributionWorkflowDependencies {
	listHouseholdMembers?: (householdId: string) => Promise<readonly HouseholdPickupMember[]>;
}

/**
 * One household member collects a meal for several in-shelter members (#1154): one
 * `distribution_log` per member so the per-recipient repeat-meal rule sees each of them.
 * CouchDB is not atomic across docs, so each member gets its own result; a retry of only the
 * failed members cannot double-log the others because their repeat-meal check now blocks.
 */
export async function recordHouseholdMealPickup(
	ticketId: string,
	input: HouseholdMealPickupInput,
	ctx: AuthorContext,
	deps?: HouseholdMealPickupDependencies
): Promise<HouseholdMealPickupResult[]> {
	assertCanPerformFrontlineDistribution(ctx);

	const listMembers =
		deps?.listHouseholdMembers ??
		((id: string) => peopleRepository(ctx.shelterCode).listHouseholdMembers(id));
	const members = await listMembers(input.household_id);

	if (!members.some((m) => m._id === input.collector_id)) {
		throw new WorkflowValidationError(
			`The collector ${input.collector_id} is not a member of ${input.household_id}`
		);
	}
	const eligible = new Set(
		members.filter((m) => isInShelterStayStatus(m.current_stay?.status)).map((m) => m._id)
	);
	const seen = new Set<string>();
	for (const { evacuee_id } of input.selections) {
		if (seen.has(evacuee_id)) {
			throw new WorkflowValidationError(`${evacuee_id} is selected more than once`);
		}
		seen.add(evacuee_id);
		if (!eligible.has(evacuee_id)) {
			throw new WorkflowValidationError(
				`${evacuee_id} is not an in-shelter member of ${input.household_id}`
			);
		}
	}

	const workflowDeps: DistributionWorkflowDependencies | undefined = deps
		? { ticketRepo: deps.ticketRepo, logRepo: deps.logRepo, ledgerReader: deps.ledgerReader }
		: undefined;

	// Sequential: each write's in-hand check must see the logs written before it.
	const results: HouseholdMealPickupResult[] = [];
	for (const selection of input.selections) {
		try {
			const log = await recordFoodDistribution(
				ticketId,
				{
					item_id: input.item_id,
					qty: '1',
					recipient_type: 'evacuee',
					recipient_id: selection.evacuee_id,
					household_id: input.household_id,
					collected_by_recipient_id:
						selection.evacuee_id === input.collector_id ? undefined : input.collector_id,
					meal_service_id: input.meal_service_id,
					recipe_id: input.recipe_id,
					is_override: selection.override_reason !== undefined,
					override_reason: selection.override_reason,
					notes: input.notes,
					menu_check: selection.menu_check,
					allergen_check: selection.allergen_check
				},
				ctx,
				workflowDeps
			);
			results.push({ evacuee_id: selection.evacuee_id, ok: true, log });
		} catch (error) {
			results.push({ evacuee_id: selection.evacuee_id, ok: false, error });
		}
	}
	return results;
}
