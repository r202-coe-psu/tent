import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { kitchenRepository } from '../data/kitchen.remote';
import { getActiveSopProfile } from '$lib/features/sop-ratios';
import { peopleRepository } from '$lib/features/people';
import { catalogRepository } from '$lib/features/catalog';
import type {
	MealPlan,
	MealPlanInput,
	KitchenRequisitionInput,
	MealServiceInput,
	GasCylinderType,
	GasCylinderTypeInput
} from '../domain/kitchen';
import {
	calculateMealIngredients,
	calculateMealIngredientsFromRecipe,
	calculateMealIngredientsFromCustom,
	DEFAULT_RICE_G_PER_PERSON_MEAL,
	type CustomIngredientInput
} from '../domain/meal-calc';
import { deriveHeadcountFromOccupancy } from '../domain/occupancy';
import type { MealPlanHeadcount, MealPeriod } from '../domain/kitchen';

export const kitchenKeys = {
	all: ['kitchen'] as const,
	mealPlans: () => [...kitchenKeys.all, 'meal_plans'] as const,
	requisitions: () => [...kitchenKeys.all, 'requisitions'] as const,
	mealServices: () => [...kitchenKeys.all, 'meal_services'] as const,
	gasCylinderTypes: () => [...kitchenKeys.all, 'gas_cylinder_types'] as const,
	occupancy: () => [...kitchenKeys.all, 'occupancy'] as const
};

// --- Occupancy (T-06 handoff) ---
// Live headcount derived from currently checked-in evacuees. Re-derives on any
// evacuee change via the kitchen live-query, so meal-plan previews re-calc.

export const useOccupancyHeadcount = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.occupancy(),
		queryFn: async () => deriveHeadcountFromOccupancy(await peopleRepository().listEvacuees())
	}));

// --- MealPlan ---

export const useMealPlans = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.mealPlans(),
		queryFn: () => kitchenRepository().listMealPlans()
	}));

export const useCreateMealPlan = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: MealPlanInput; ctx: AuthorContext }) =>
			kitchenRepository().createMealPlan(input, ctx)
	}));

// Shared by create/update: recipeId (catalog BOM) sources ingredients from a
// catalog Recipe, custom (ad-hoc supply_item list) from staff-typed rows;
// otherwise falls back to the SOP-ratio rice calc. Rice ratio is a kitchen
// coefficient, not a SOP ratio (CR-021) — the SOP profile is still read to
// stamp calc_source provenance in all three cases.
async function resolveMealPlanCalc(
	headcount: MealPlanHeadcount,
	recipeId: string | undefined,
	custom: CustomIngredientInput[] | undefined,
	headcountAsOf: string
) {
	const profile = await getActiveSopProfile();
	if (!profile) throw new Error('No active SOP profile found — seed one first');
	if (recipeId) {
		const recipe = await catalogRepository().getRecipe(recipeId);
		if (!recipe) throw new Error(`resolveMealPlanCalc: recipe "${recipeId}" not found`);
		const itemMasters = await catalogRepository().listItemMasters();
		const itemUnits = Object.fromEntries(itemMasters.map((im) => [im._id, im.base_unit]));
		return calculateMealIngredientsFromRecipe(
			recipe,
			headcount,
			itemUnits,
			profile._id,
			profile.version,
			headcountAsOf
		);
	}
	if (custom) {
		return calculateMealIngredientsFromCustom(
			custom,
			headcount,
			profile._id,
			profile.version,
			headcountAsOf
		);
	}
	return calculateMealIngredients(
		headcount,
		DEFAULT_RICE_G_PER_PERSON_MEAL,
		profile._id,
		profile.version,
		headcountAsOf
	);
}

export const useCreateMealPlanCalc = () =>
	createMutation(() => ({
		mutationFn: async ({
			date,
			meal,
			label,
			headcount,
			override_reason,
			recipeId,
			custom,
			ctx
		}: {
			date: string;
			meal: MealPeriod;
			label?: string;
			headcount: MealPlanHeadcount;
			override_reason?: string | null;
			recipeId?: string;
			custom?: CustomIngredientInput[];
			ctx: AuthorContext;
		}) => {
			const headcountAsOf = new Date().toISOString();
			const { recipes, calc_source } = await resolveMealPlanCalc(
				headcount,
				recipeId,
				custom,
				headcountAsOf
			);
			// _id is a fresh ulid (kitchen.ts createMealPlan) — always a genuine new
			// doc, multiple plans for the same date+meal are allowed by design.
			return kitchenRepository().createMealPlan(
				{
					date,
					meal,
					headcount,
					recipes,
					calc_source,
					override_reason,
					...(label ? { label } : {})
				},
				ctx
			);
		}
	}));

export const useConfirmMealPlan = () =>
	createMutation(() => ({
		mutationFn: (plan: MealPlan) => kitchenRepository().confirmMealPlan(plan)
	}));

// Draft-only edit — recomputes recipes the same way useCreateMealPlanCalc does,
// then patches the existing doc in place (date/meal/_id stay fixed).
export const useUpdateMealPlanCalc = () =>
	createMutation(() => ({
		mutationFn: async ({
			plan,
			label,
			headcount,
			override_reason,
			recipeId,
			custom
		}: {
			plan: MealPlan;
			label?: string;
			headcount: MealPlanHeadcount;
			override_reason?: string | null;
			recipeId?: string;
			custom?: CustomIngredientInput[];
		}) => {
			const { recipes, calc_source } = await resolveMealPlanCalc(
				headcount,
				recipeId,
				custom,
				new Date().toISOString()
			);
			return kitchenRepository().updateMealPlanDraft(plan, {
				headcount,
				recipes,
				calc_source,
				override_reason,
				...(label ? { label } : {})
			});
		}
	}));

export const useDeleteMealPlanDraft = () =>
	createMutation(() => ({
		mutationFn: (plan: MealPlan) => kitchenRepository().deleteMealPlanDraft(plan)
	}));

// --- KitchenRequisition ---

export const useRequisitions = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.requisitions(),
		queryFn: () => kitchenRepository().listRequisitions()
	}));

export const useIssueRequisition = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: KitchenRequisitionInput; ctx: AuthorContext }) =>
			kitchenRepository().issueRequisition(input, ctx)
	}));

// --- MealService ---

export const useMealServices = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.mealServices(),
		queryFn: () => kitchenRepository().listMealServices()
	}));

export const useRecordMealService = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: MealServiceInput; ctx: AuthorContext }) =>
			kitchenRepository().recordMealService(input, ctx)
	}));

// --- GasCylinderType ---

export const useGasCylinderTypes = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.gasCylinderTypes(),
		queryFn: () => kitchenRepository().listGasCylinderTypes()
	}));

export const useCreateGasCylinderType = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: GasCylinderTypeInput; ctx: AuthorContext }) =>
			kitchenRepository().createGasCylinderType(input, ctx)
	}));

export const useUpdateGasCylinderType = () =>
	createMutation(() => ({
		mutationFn: ({ doc, input }: { doc: GasCylinderType; input: GasCylinderTypeInput }) =>
			kitchenRepository().updateGasCylinderType(doc, input)
	}));

export const useDeleteGasCylinderType = () =>
	createMutation(() => ({
		mutationFn: (doc: GasCylinderType) => kitchenRepository().deleteGasCylinderType(doc)
	}));

// --- Live sync ---

export function startKitchenLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		switch (type) {
			case 'meal_plan':
				return [kitchenKeys.mealPlans()];
			case 'kitchen_requisition':
				return [kitchenKeys.requisitions()];
			case 'meal_service':
				return [kitchenKeys.mealServices()];
			case 'gas_cylinder_type':
				return [kitchenKeys.gasCylinderTypes()];
			case 'evacuee':
			case 'movement':
				return [kitchenKeys.occupancy()];
			default:
				return [];
		}
	});
}
