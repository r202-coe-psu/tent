import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb, getShelterCode } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { kitchenRepository } from '../data/kitchen.remote';
import { getActiveSopProfile } from '$lib/features/sop-ratios';
import { peopleRepository } from '$lib/features/people';
import { catalogRepository, itemMasterUnit, systemCategoryId } from '$lib/features/catalog';
import { operationsKeys } from '$lib/features/operations';
import { supplyRepository } from '$lib/features/supply';
import type {
	MealSession,
	MealSessionInput,
	MealPlan,
	MealPlanInput,
	KitchenRequisitionInput,
	MealServiceInput
} from '../domain/kitchen';
import type {
	CreatePendingRequisitionParams,
	ApproveRequisitionOptions
} from '../data/kitchen.repository';
import {
	calculateMealIngredients,
	calculateMealIngredientsFromRecipe,
	calculateMealIngredientsFromCustom,
	resolveItemMasterStock,
	DEFAULT_RICE_G_PER_PERSON_MEAL,
	type CustomIngredientInput
} from '../domain/meal-calc';
import {
	deriveHeadcountFromOccupancy,
	deriveSessionHeadcountFromOccupancy
} from '../domain/occupancy';
import type { MealPlanHeadcount, MealPeriod, MealService } from '../domain/kitchen';
import {
	yieldReceiptInputSchema,
	type ResolvedYieldLine,
	type YieldReceiptInput
} from '../domain/kitchen-yield-receipt';

export const kitchenKeys = {
	all: ['kitchen'] as const,
	mealSessions: () => [...kitchenKeys.all, 'meal_sessions', getShelterCode()] as const,
	mealSession: (id: string) => [...kitchenKeys.all, 'meal_session', getShelterCode(), id] as const,
	mealPlans: () => [...kitchenKeys.all, 'meal_plans', getShelterCode()] as const,
	requisitions: () => [...kitchenKeys.all, 'requisitions', getShelterCode()] as const,
	kitchenRequisition: (id: string) =>
		[...kitchenKeys.all, 'kitchen_requisition', getShelterCode(), id] as const,
	mealServices: () => [...kitchenKeys.all, 'meal_services', getShelterCode()] as const,
	mealServiceReceipts: () =>
		[...kitchenKeys.all, 'meal_service_receipts', getShelterCode()] as const,
	occupancy: () => [...kitchenKeys.all, 'occupancy', getShelterCode()] as const,
	dietCounts: () => [...kitchenKeys.all, 'diet_counts', getShelterCode()] as const
};

// --- Occupancy & Diet Counts (T-06 handoff & 2-Tier Headcount) ---
// Live headcount derived from currently checked-in evacuees. Re-derives on any
// evacuee change via the kitchen live-query, so meal-plan previews re-calc.

export const useOccupancyHeadcount = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.occupancy(),
		queryFn: async () => deriveHeadcountFromOccupancy(await peopleRepository().listEvacuees())
	}));

export const useActiveEvacueeDietCounts = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.dietCounts(),
		queryFn: async () =>
			deriveSessionHeadcountFromOccupancy(await peopleRepository().listEvacuees())
	}));

// --- MealSession (schema.md §2.7.3) ---

export const useMealSessions = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.mealSessions(),
		queryFn: () => kitchenRepository().listMealSessions()
	}));

export const useMealSession = (id: () => string | undefined) =>
	createQuery(() => {
		const sessionId = id();
		return {
			queryKey: kitchenKeys.mealSession(sessionId ?? ''),
			queryFn: () => (sessionId ? kitchenRepository().getMealSessionById(sessionId) : null),
			enabled: !!sessionId
		};
	});

export const useCreateMealSession = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: MealSessionInput; ctx: AuthorContext }) =>
			kitchenRepository().createMealSession(input, ctx)
	}));

export const useUpdateMealSession = () =>
	createMutation(() => ({
		mutationFn: ({ session, patch }: { session: MealSession; patch: Partial<MealSessionInput> }) =>
			kitchenRepository().updateMealSession(session, patch)
	}));

export const useDeleteMealSession = () =>
	createMutation(() => ({
		mutationFn: (session: MealSession) => kitchenRepository().deleteMealSession(session)
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

// Resolves ingredient calculations from recipe, custom ingredients, or default rice ratio.
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
		const [itemMasters, supplyItems] = await Promise.all([
			catalogRepository().listItemMasters(),
			supplyRepository().listItems()
		]);
		const itemInfo = resolveItemMasterStock(itemMasters, supplyItems);
		return calculateMealIngredientsFromRecipe(
			recipe,
			headcount,
			itemInfo,
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

export const useStartMealPlanCooking = () =>
	createMutation(() => ({
		mutationFn: ({
			plan,
			cookingStartedAt
		}: {
			plan: MealPlan;
			cookingStartedAt: NonNullable<MealPlan['cooking_started_at']>;
		}) => kitchenRepository().startMealPlanCooking(plan, cookingStartedAt)
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
			// Pass `label` unconditionally (not a conditional spread):
			// editing to empty must actually clear the old value. `undefined` is
			// dropped on persist (kitchen.remote.ts), so the stored doc loses the
			// key rather than keeping a stale value.
			return kitchenRepository().updateMealPlanDraft(plan, {
				headcount,
				recipes,
				calc_source,
				override_reason,
				label
			});
		}
	}));

// Confirmed plan edit (CR-142) — caller must have already confirmed the
// linked ticket is still PENDING_PICK (e.g. by updating the ticket first).
export const useUpdateConfirmedMealPlan = () =>
	createMutation(() => ({
		mutationFn: ({
			plan,
			patch
		}: {
			plan: MealPlan;
			patch: Parameters<ReturnType<typeof kitchenRepository>['updateConfirmedMealPlan']>[1];
		}) => kitchenRepository().updateConfirmedMealPlan(plan, patch)
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

export const useKitchenRequisitions = useRequisitions;

export const useKitchenRequisition = (id: () => string | undefined) =>
	createQuery(() => {
		const reqId = id();
		return {
			queryKey: kitchenKeys.kitchenRequisition(reqId ?? ''),
			queryFn: () => (reqId ? kitchenRepository().getKitchenRequisitionById(reqId) : null),
			enabled: !!reqId
		};
	});

export const useCreatePendingRequisition = () =>
	createMutation(() => ({
		mutationFn: ({ params, ctx }: { params: CreatePendingRequisitionParams; ctx: AuthorContext }) =>
			kitchenRepository().createPendingRequisition(params, ctx)
	}));

export const useApproveKitchenRequisition = () =>
	createMutation(() => ({
		mutationFn: ({
			requisitionId,
			approver,
			options,
			ctx
		}: {
			requisitionId: string;
			approver: string;
			options?: ApproveRequisitionOptions;
			ctx?: AuthorContext;
		}) => kitchenRepository().approveKitchenRequisition(requisitionId, approver, options, ctx)
	}));

export const useRejectKitchenRequisition = () =>
	createMutation(() => ({
		mutationFn: ({
			requisitionId,
			reason,
			ctx
		}: {
			requisitionId: string;
			reason: string;
			ctx: AuthorContext;
		}) => kitchenRepository().rejectKitchenRequisition(requisitionId, reason, ctx)
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

// --- MealServiceReceipt (CR-144) ---

export const useMealServiceReceipts = () =>
	createQuery(() => ({
		queryKey: kitchenKeys.mealServiceReceipts(),
		queryFn: () => kitchenRepository().listMealServiceReceipts()
	}));

export const useConfirmMealServiceReceipt = () =>
	createMutation(() => ({
		mutationFn: ({ mealServiceId, ctx }: { mealServiceId: string; ctx: AuthorContext }) =>
			kitchenRepository().confirmMealServiceReceipt(mealServiceId, ctx)
	}));

/**
 * Confirm receipt of a meal_service AND put the cooked food into stock. Every
 * line must name an existing ready-meal item; the ledger unit is taken from the
 * item's base unit, never from the form.
 */
export const useConfirmMealServiceYield = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			service,
			input,
			ctx
		}: {
			service: MealService;
			input: YieldReceiptInput;
			ctx: AuthorContext;
		}) => {
			const { lines } = yieldReceiptInputSchema.parse(input);
			const shelterCode = getShelterCode();
			const readyMeal = systemCategoryId('READY_MEAL');
			const items = new Map(
				await Promise.all(
					[...new Set(lines.map((l) => l.item_id))].map(
						async (id) => [id, await catalogRepository().getItemMaster(id, shelterCode)] as const
					)
				)
			);
			const resolved: ResolvedYieldLine[] = lines.map((line) => {
				const item = items.get(line.item_id);
				if (!item) throw new Error(`ไม่พบรายการ ${line.item_id} ในแคตตาล็อก`);
				if (item.category !== readyMeal) {
					throw new Error(`"${item.name}" ไม่ใช่รายการในหมวดอาหารปรุงสำเร็จ`);
				}
				return { ...line, unit: itemMasterUnit(item), item_name: item.name };
			});
			return kitchenRepository().confirmMealServiceReceiptWithYield(service, resolved, ctx);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: kitchenKeys.mealServiceReceipts() });
			void queryClient.invalidateQueries({ queryKey: operationsKeys.all });
		}
	}));
};

export const useRejectMealServiceReceipt = () =>
	createMutation(() => ({
		mutationFn: ({
			mealServiceId,
			reason,
			ctx
		}: {
			mealServiceId: string;
			reason: string;
			ctx: AuthorContext;
		}) => kitchenRepository().rejectMealServiceReceipt(mealServiceId, reason, ctx)
	}));

// --- Live sync ---

export function startKitchenLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		switch (type) {
			case 'meal_session':
				return [kitchenKeys.mealSessions()];
			case 'meal_plan':
				return [kitchenKeys.mealPlans(), kitchenKeys.mealSessions()];
			case 'kitchen_requisition':
				return [kitchenKeys.requisitions()];
			case 'kitchen_counter':
				return [kitchenKeys.requisitions()];
			case 'meal_service':
				return [kitchenKeys.mealServices(), kitchenKeys.mealSessions()];
			case 'meal_service_receipt':
				return [kitchenKeys.mealServiceReceipts()];
			case 'stock_ledger':
				return [kitchenKeys.requisitions()];
			case 'evacuee':
			case 'movement':
				return [kitchenKeys.occupancy(), kitchenKeys.dietCounts()];
			default:
				return [];
		}
	});
}
