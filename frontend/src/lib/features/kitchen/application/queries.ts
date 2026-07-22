import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb, getShelterCode } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { kitchenRepository } from '../data/kitchen.remote';
import { getActiveSopProfile } from '$lib/features/sop-ratios';
import { peopleRepository } from '$lib/features/people';
import type {
	MealPlan,
	MealPlanInput,
	KitchenRequisitionInput,
	MealServiceInput,
	GasCylinderType,
	GasCylinderTypeInput
} from '../domain/kitchen';
import { calculateMealIngredients, DEFAULT_RICE_G_PER_PERSON_MEAL } from '../domain/meal-calc';
import { deriveHeadcountFromOccupancy } from '../domain/occupancy';
import type { MealPlanHeadcount, MealPeriod } from '../domain/kitchen';

export const kitchenKeys = {
	all: ['kitchen'] as const,
	mealPlans: () => [...kitchenKeys.all, 'meal_plans', getShelterCode()] as const,
	requisitions: () => [...kitchenKeys.all, 'requisitions', getShelterCode()] as const,
	mealServices: () => [...kitchenKeys.all, 'meal_services', getShelterCode()] as const,
	gasCylinderTypes: () => [...kitchenKeys.all, 'gas_cylinder_types', getShelterCode()] as const,
	occupancy: () => [...kitchenKeys.all, 'occupancy', getShelterCode()] as const
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

export const useCreateMealPlanCalc = () =>
	createMutation(() => ({
		mutationFn: async ({
			date,
			meal,
			headcount,
			override_reason,
			ctx
		}: {
			date: string;
			meal: MealPeriod;
			headcount: MealPlanHeadcount;
			override_reason?: string | null;
			ctx: AuthorContext;
		}) => {
			const profile = await getActiveSopProfile();
			if (!profile) throw new Error('No active SOP profile found — seed one first');
			// Rice ratio is a kitchen coefficient, not a SOP ratio (CR-021). The SOP
			// profile is still read to stamp calc_source provenance (which planning
			// profile was active), but the rice grams come from the kitchen constant.
			const { recipes, calc_source } = calculateMealIngredients(
				headcount,
				DEFAULT_RICE_G_PER_PERSON_MEAL,
				profile._id,
				profile.version,
				new Date().toISOString()
			);
			return kitchenRepository().createMealPlan(
				{ date, meal, headcount, recipes, calc_source, override_reason },
				ctx
			);
		}
	}));

export const useConfirmMealPlan = () =>
	createMutation(() => ({
		mutationFn: (plan: MealPlan) => kitchenRepository().confirmMealPlan(plan)
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
