import { bulkDocs } from '$lib/db/couch-db';
import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { makeDocId, now, touch, type AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { getShelterDb } from '$lib/db/shelter';
import {
	createMealPlan,
	createKitchenRequisition,
	createMealService,
	createGasCylinderType,
	gasCylinderTypeInputSchema,
	isMealPlan,
	isKitchenRequisition,
	isMealService,
	isGasCylinderType,
	type MealPlan,
	type MealPlanInput,
	type KitchenRequisition,
	type KitchenRequisitionInput,
	type MealService,
	type MealServiceInput,
	type GasCylinderType,
	type GasCylinderTypeInput
} from '../domain/kitchen';
import { stockBalance, isStockLedger, type StockLedger } from '$lib/features/operations';
import { qtyGt, qtyNeg } from '$lib/utils/qty';
import type { KitchenRepository } from './kitchen.repository';

export class KitchenRemoteRepository implements KitchenRepository {
	private readonly dbName: string;
	private readonly repo: Repository;

	constructor(dbName: string) {
		this.dbName = dbName;
		this.repo = createRemoteRepository(dbName);
	}

	createMealPlan(input: MealPlanInput, ctx: AuthorContext): Promise<MealPlan> {
		return this.repo.put(createMealPlan(input, ctx));
	}

	getMealPlanById(id: string): Promise<MealPlan | null> {
		return this.repo.get<MealPlan>(id);
	}

	// @deprecated Ambiguous once multiple plans can share a date+meal — returns
	// whichever `allByType` yields first. Prefer getMealPlanById when the specific
	// plan is known; kept only for callers that still key off date+meal.
	async getMealPlan(date: string, meal: string): Promise<MealPlan | null> {
		const plans = await this.listMealPlans();
		return plans.find((p) => p.date === date && p.meal === meal) ?? null;
	}

	listMealPlans(): Promise<MealPlan[]> {
		return this.repo.allByType('meal_plan', isMealPlan);
	}

	async issueRequisition(
		input: KitchenRequisitionInput,
		ctx: AuthorContext
	): Promise<KitchenRequisition> {
		const issuedItems = (input.items ?? []).filter((i) => qtyGt(i.qty_issued ?? '0', 0));

		if (issuedItems.length > 0) {
			const ledger = await this.repo.allByType<StockLedger>('stock_ledger', isStockLedger);
			const balance = stockBalance(ledger);
			for (const item of issuedItems) {
				const onHand = balance.get(item.item_id) ?? '0';
				if (qtyGt(item.qty_issued, onHand)) {
					throw new Error(
						`issueRequisition: cannot issue ${item.qty_issued} ${item.unit} of ${item.item_id} — only ${onHand} on hand`
					);
				}
			}
		}

		const ledgerIds = issuedItems.map(() => makeDocId('stock_ledger', ulid()));
		const requisition = createKitchenRequisition(input, ledgerIds, ctx);
		const ts = now();
		const ledgerEntries = issuedItems.map((item, i) => ({
			_id: ledgerIds[i],
			type: 'stock_ledger' as const,
			schema_v: 2,
			shelter_code: ctx.shelterCode,
			created_at: ts,
			updated_at: ts,
			created_by: ctx.createdBy,
			item_id: item.item_id,
			qty: qtyNeg(item.qty_issued),
			unit: item.unit,
			reason: 'requisition' as const,
			ref_id: requisition._id,
			occurred_at: ts
		}));

		await bulkDocs(this.dbName, [requisition, ...ledgerEntries]);
		return requisition;
	}

	listRequisitions(): Promise<KitchenRequisition[]> {
		return this.repo.allByType('kitchen_requisition', isKitchenRequisition);
	}

	// One recorded service per plan: ulid _id lost the idempotence the old
	// deterministic id gave, so a double-submit/race could otherwise write two
	// services for the same meal_plan_id (summary would then double-count). This
	// repo-level guard rejects the second write — a real uniqueness check, not
	// just the UI button's isPending. Only guards plan-linked services; a
	// planless service (meal_plan_id null) has no plan to be unique against.
	async recordMealService(input: MealServiceInput, ctx: AuthorContext): Promise<MealService> {
		if (input.meal_plan_id) {
			const existing = await this.getMealServiceByPlanId(input.meal_plan_id);
			if (existing) {
				throw new Error('recordMealService: a service is already recorded for this meal plan');
			}
		}
		return this.repo.put(createMealService(input, ctx));
	}

	// Looks up the service recorded against a specific plan (the reliable join now
	// that multiple plans share a date+meal). Returns null when none exists yet.
	async getMealServiceByPlanId(mealPlanId: string): Promise<MealService | null> {
		const services = await this.listMealServices();
		return services.find((s) => s.meal_plan_id === mealPlanId) ?? null;
	}

	// @deprecated Ambiguous when more than one meal_service shares the date+meal
	// (each plan for a slot gets its own record) — returns whichever
	// `listMealServices` yields first. Prefer getMealServiceByPlanId.
	async getMealService(date: string, meal: string): Promise<MealService | null> {
		const services = await this.listMealServices();
		return services.find((s) => s.date === date && s.meal === meal) ?? null;
	}

	listMealServices(): Promise<MealService[]> {
		return this.repo.allByType('meal_service', isMealService);
	}

	async confirmMealPlan(plan: MealPlan): Promise<MealPlan> {
		if (plan.status !== 'draft') {
			throw new Error('confirmMealPlan: only draft plans can be confirmed');
		}
		return this.repo.put({ ...touch(plan), status: 'confirmed' });
	}

	async updateMealPlanDraft(
		plan: MealPlan,
		patch: Pick<MealPlan, 'headcount' | 'recipes' | 'calc_source' | 'override_reason' | 'label'>
	): Promise<MealPlan> {
		if (plan.status !== 'draft') {
			throw new Error('updateMealPlanDraft: only draft plans can be edited');
		}
		const next = { ...touch(plan), ...patch };
		// An explicit `label: undefined` in the patch means "clear it" — drop the
		// key so the stored doc loses the old label instead of keeping it.
		if (patch.label === undefined) delete next.label;
		return this.repo.put(next);
	}

	async deleteMealPlanDraft(plan: MealPlan): Promise<void> {
		if (plan.status !== 'draft') {
			throw new Error('deleteMealPlanDraft: only draft plans can be deleted');
		}
		await this.repo.remove(plan);
	}

	createGasCylinderType(input: GasCylinderTypeInput, ctx: AuthorContext): Promise<GasCylinderType> {
		return this.repo.put(createGasCylinderType(input, ctx));
	}

	listGasCylinderTypes(): Promise<GasCylinderType[]> {
		return this.repo.allByType('gas_cylinder_type', isGasCylinderType);
	}

	updateGasCylinderType(
		doc: GasCylinderType,
		input: GasCylinderTypeInput
	): Promise<GasCylinderType> {
		const d = gasCylinderTypeInputSchema.parse(input);
		return this.repo.put(touch({ ...doc, ...d }));
	}

	async deleteGasCylinderType(doc: GasCylinderType): Promise<void> {
		await this.repo.remove(doc);
	}
}

let singleton: KitchenRepository | null = null;
let singletonDbName: string | null = null;

export function kitchenRepository(): KitchenRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new KitchenRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
