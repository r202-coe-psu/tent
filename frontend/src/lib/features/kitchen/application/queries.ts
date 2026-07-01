import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import { shelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { kitchenRepository } from '../data/kitchen.pouch';
import { getActiveSopProfile } from '$lib/features/sop-ratios';
import type {
	MealPlan,
	MealPlanInput,
	KitchenRequisitionInput,
	MealServiceInput,
	GasCylinderType,
	GasCylinderTypeInput
} from '../domain/kitchen';
import { calculateMealIngredients } from '../domain/meal-calc';
import type { MealPlanHeadcount, MealPeriod } from '../domain/kitchen';

export const kitchenKeys = {
	all: ['kitchen'] as const,
	mealPlans: () => [...kitchenKeys.all, 'meal_plans'] as const,
	requisitions: () => [...kitchenKeys.all, 'requisitions'] as const,
	mealServices: () => [...kitchenKeys.all, 'meal_services'] as const,
	gasCylinderTypes: () => [...kitchenKeys.all, 'gas_cylinder_types'] as const
};

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
			ctx
		}: {
			date: string;
			meal: MealPeriod;
			headcount: MealPlanHeadcount;
			ctx: AuthorContext;
		}) => {
			const profile = await getActiveSopProfile();
			if (!profile) throw new Error('No active SOP profile found — seed one first');
			const riceG = profile.ratios.rice_g_per_person_meal;
			if (!riceG) throw new Error('Active SOP profile missing rice_g_per_person_meal');
			const { recipes, calc_source } = calculateMealIngredients(
				headcount,
				riceG,
				profile._id,
				profile.version,
				new Date().toISOString()
			);
			return kitchenRepository().createMealPlan(
				{ date, meal, headcount, recipes, calc_source },
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

export function startKitchenLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(shelterDb(), queryClient, (type) => {
		switch (type) {
			case 'meal_plan':
				return [kitchenKeys.mealPlans()];
			case 'kitchen_requisition':
				return [kitchenKeys.requisitions()];
			case 'meal_service':
				return [kitchenKeys.mealServices()];
			case 'gas_cylinder_type':
				return [kitchenKeys.gasCylinderTypes()];
			default:
				return [];
		}
	});
}
