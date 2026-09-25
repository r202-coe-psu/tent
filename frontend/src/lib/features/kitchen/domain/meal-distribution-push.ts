import { z } from 'zod';
import type { BaseDoc, AuthorContext } from '$lib/db/model';
import { makeDoc } from '$lib/db/model';

// ---- MealDistributionPush (append-only, CR-131) ----
// Pushes confirmed-receipt meal_service output to a distribution point. Deliberately
// separate from the CR-059 distribution_request/batch engine (built for per-evacuee
// NFI issuing against real stock_ledger lots) and from CR-121's spec-only
// distribution_log — see CR-131 for why. No real POS-station doc exists yet, so
// `pos_station` is free text, same convention as requisition_ticket.destination_location.

export const mealDistributionPushItemSchema = z.object({
	meal_service_id: z.string().min(1),
	menu_label: z.string().trim().min(1),
	qty: z.number().int().positive()
});
export type MealDistributionPushItem = z.infer<typeof mealDistributionPushItemSchema>;

export interface MealDistributionPush extends BaseDoc {
	type: 'meal_distribution_push';
	pos_station: string;
	meal_session_id: string;
	dispatcher: string;
	vehicle?: string;
	items: MealDistributionPushItem[];
}

export const mealDistributionPushInputSchema = z.object({
	pos_station: z.string().trim().min(1),
	meal_session_id: z.string().min(1),
	dispatcher: z.string().trim().min(1),
	vehicle: z.string().trim().optional(),
	items: z.array(mealDistributionPushItemSchema).min(1)
});
export type MealDistributionPushInput = z.input<typeof mealDistributionPushInputSchema>;

export function createMealDistributionPush(
	input: MealDistributionPushInput,
	ctx: AuthorContext
): MealDistributionPush {
	const d = mealDistributionPushInputSchema.parse(input);
	return makeDoc(
		'meal_distribution_push',
		1,
		{
			pos_station: d.pos_station,
			meal_session_id: d.meal_session_id,
			dispatcher: d.dispatcher,
			...(d.vehicle ? { vehicle: d.vehicle } : {}),
			items: d.items
		},
		ctx
	) as MealDistributionPush;
}

export const isMealDistributionPush = (d: unknown): d is MealDistributionPush =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'meal_distribution_push';

/** Remaining pushable qty for a meal_service: actual_yield − sum of all prior pushes. */
export function mealServicePushRemaining(
	actualYield: number,
	mealServiceId: string,
	pushes: readonly MealDistributionPush[]
): number {
	const pushed = pushes
		.flatMap((p) => p.items)
		.filter((i) => i.meal_service_id === mealServiceId)
		.reduce((sum, i) => sum + i.qty, 0);
	return actualYield - pushed;
}
