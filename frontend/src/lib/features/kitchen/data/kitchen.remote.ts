import { bulkDocs } from '$lib/db/couch-db';
import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { makeDocId, now, touch, type AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { getShelterDb } from '$lib/db/shelter';
import {
	createMealPlan,
	createKitchenRequisition,
	createPendingRequisition,
	createMealSession,
	createMealService,
	createMealServiceReceipt,
	isMealPlan,
	isKitchenRequisition,
	isMealService,
	isMealServiceReceipt,
	isMealSession,
	type MealPlan,
	type MealPlanInput,
	type KitchenRequisition,
	type KitchenRequisitionInput,
	type MealService,
	type MealServiceInput,
	type MealServiceReceipt,
	type MealSession,
	type MealSessionInput
} from '../domain/kitchen';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	stockBalance,
	storageLotFields,
	isStockLedger,
	type StockLedger
} from '$lib/features/operations';
import {
	kitchenYieldExpiry,
	mergeYieldLines,
	type ResolvedYieldLine
} from '../domain/kitchen-yield-receipt';
import { persistQty, qtyGt, qtyNeg } from '$lib/utils/qty';
import type {
	KitchenRepository,
	CreatePendingRequisitionParams,
	ApproveRequisitionOptions
} from './kitchen.repository';

export class KitchenRemoteRepository implements KitchenRepository {
	private readonly dbName: string;
	private readonly repo: Repository;

	constructor(dbName: string) {
		this.dbName = dbName;
		this.repo = createRemoteRepository(dbName);
	}

	createMealSession(input: MealSessionInput, ctx: AuthorContext): Promise<MealSession> {
		return this.repo.put(createMealSession(input, ctx));
	}

	getMealSessionById(id: string): Promise<MealSession | null> {
		return this.repo.get<MealSession>(id);
	}

	listMealSessions(): Promise<MealSession[]> {
		return this.repo.allByType('meal_session', isMealSession);
	}

	async updateMealSession(
		session: MealSession,
		patch: Partial<MealSessionInput>
	): Promise<MealSession> {
		const next = { ...touch(session), ...patch };
		return this.repo.put(next);
	}

	async deleteMealSession(session: MealSession): Promise<void> {
		await this.repo.remove(session);
	}

	createMealPlan(input: MealPlanInput, ctx: AuthorContext): Promise<MealPlan> {
		return this.repo.put(createMealPlan(input, ctx));
	}

	getMealPlanById(id: string): Promise<MealPlan | null> {
		return this.repo.get<MealPlan>(id);
	}

	// Find first meal plan matching date and meal period. Prefer getMealPlanById.
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

		// Mint ledger document IDs before saving requisition and ledger entries.
		const ledgerUlids = issuedItems.map(() => ulid());
		const ledgerIds = ledgerUlids.map((id) => makeDocId('stock_ledger', id));
		const requisition = createKitchenRequisition(input, ledgerIds, ctx);
		const ts = now();
		const ledgerEntries = issuedItems.map((item, i) =>
			createStockLedger(
				{
					item_id: item.item_id,
					qty: qtyNeg(item.qty_issued),
					unit: item.unit,
					reason: 'requisition',
					ref_id: requisition._id,
					occurred_at: ts
				},
				ctx,
				ledgerUlids[i]
			)
		);
		await bulkDocs(this.dbName, [requisition, ...ledgerEntries]);
		return requisition;
	}

	listRequisitions(): Promise<KitchenRequisition[]> {
		return this.repo.allByType('kitchen_requisition', isKitchenRequisition);
	}

	getKitchenRequisitionById(id: string): Promise<KitchenRequisition | null> {
		return this.repo.get<KitchenRequisition>(id);
	}

	async createPendingRequisition(
		params: CreatePendingRequisitionParams,
		ctx: AuthorContext
	): Promise<{ plan?: MealPlan; requisition: KitchenRequisition }> {
		let planDoc: MealPlan | undefined;
		if (params.planInput) {
			planDoc = createMealPlan(params.planInput, ctx);
		}

		const mealPlanId = planDoc ? planDoc._id : (params.requisitionInput.meal_plan_id ?? null);
		const requisitionDoc = createPendingRequisition(
			{
				...params.requisitionInput,
				meal_plan_id: mealPlanId
			},
			ctx
		);

		const docsToWrite = [...(planDoc ? [planDoc] : []), requisitionDoc];
		await bulkDocs(this.dbName, docsToWrite);
		return { plan: planDoc, requisition: requisitionDoc };
	}

	async approveKitchenRequisition(
		requisitionId: string,
		approver: string,
		options?: ApproveRequisitionOptions,
		ctx?: AuthorContext
	): Promise<KitchenRequisition> {
		const authCtx: AuthorContext = ctx ?? {
			shelterCode: this.dbName.replace(/^shelter_/, '').toUpperCase(),
			createdBy: approver
		};
		const requisition = await this.getKitchenRequisitionById(requisitionId);
		if (!requisition) {
			throw new Error(`approveKitchenRequisition: requisition ${requisitionId} not found`);
		}
		if (requisition.status !== 'pending') {
			throw new Error(
				`approveKitchenRequisition: requisition ${requisition._id} is already ${requisition.status}`
			);
		}

		// 1. Update items with partial_items if supplied, or default qty_issued = qty_requested
		const updatedItems = requisition.items.map((item) => {
			const partial = options?.partial_items?.find((p) => p.item_id === item.item_id);
			const issued = partial ? partial.qty_issued : item.qty_requested;
			return {
				...item,
				qty_issued: persistQty(issued)
			};
		});

		// 2. Check stock balance
		const issuedItems = updatedItems.filter((i) => qtyGt(i.qty_issued, '0'));
		if (issuedItems.length > 0) {
			const ledger = await this.repo.allByType<StockLedger>('stock_ledger', isStockLedger);
			const balance = stockBalance(ledger);
			for (const item of issuedItems) {
				const onHand = balance.get(item.item_id) ?? '0';
				if (qtyGt(item.qty_issued, onHand)) {
					throw new Error(
						`approveKitchenRequisition: cannot issue ${item.qty_issued} ${item.unit} of ${item.item_id} — only ${onHand} on hand`
					);
				}
			}
		}

		// 3. Generate stock ledger entries
		const ts = now();
		const stockLedgerUlids = issuedItems.map(() => ulid());
		const stockLedgerIds = stockLedgerUlids.map((id) => makeDocId('stock_ledger', id));
		const stockLedgerEntries = issuedItems.map((item, i) =>
			createStockLedger(
				{
					item_id: item.item_id,
					qty: qtyNeg(item.qty_issued),
					unit: item.unit,
					reason: 'requisition',
					ref_id: requisition._id,
					occurred_at: ts
				},
				authCtx,
				stockLedgerUlids[i]
			)
		);

		// 4. Update requisition doc
		const approvedRequisition: KitchenRequisition = {
			...requisition,
			status: 'approved',
			items: updatedItems,
			ledger_ids: stockLedgerIds,
			approved_at: ts,
			approved_by: approver || authCtx.createdBy || 'warehouse_staff',
			updated_at: ts
		};

		// 5. If linked to meal_plan, confirm the meal_plan
		let confirmedPlan: MealPlan | null = null;
		if (requisition.meal_plan_id) {
			const plan = await this.getMealPlanById(requisition.meal_plan_id);
			if (plan && plan.status === 'draft') {
				confirmedPlan = { ...touch(plan), status: 'confirmed' };
			}
		}

		await bulkDocs(this.dbName, [
			approvedRequisition,
			...stockLedgerEntries,
			...(confirmedPlan ? [confirmedPlan] : [])
		]);

		return approvedRequisition;
	}

	async rejectKitchenRequisition(
		requisitionId: string,
		reason: string,
		ctx: AuthorContext
	): Promise<KitchenRequisition> {
		void ctx;
		const requisition = await this.getKitchenRequisitionById(requisitionId);
		if (!requisition) {
			throw new Error(`rejectKitchenRequisition: requisition ${requisitionId} not found`);
		}
		if (requisition.status !== 'pending') {
			throw new Error(
				`rejectKitchenRequisition: requisition ${requisition._id} is already ${requisition.status}`
			);
		}
		const rejectedRequisition: KitchenRequisition = {
			...touch(requisition),
			status: 'rejected',
			reject_reason: reason
		};
		return this.repo.put(rejectedRequisition);
	}

	// Ensures only one *active* meal service exists per meal plan — a rejected
	// service (CR-145) may be superseded by re-recording.
	async recordMealService(input: MealServiceInput, ctx: AuthorContext): Promise<MealService> {
		if (input.meal_plan_id) {
			const existing = await this.getMealServiceByPlanId(input.meal_plan_id);
			if (existing) {
				const receipts = await this.listMealServiceReceipts();
				const receipt = receipts.find((r) => r.meal_service_id === existing._id);
				if (!receipt || receipt.outcome !== 'rejected') {
					throw new Error('recordMealService: a service is already recorded for this meal plan');
				}
			}
		}
		return this.repo.put(createMealService(input, ctx));
	}

	// Finds the latest meal service recorded for a specific meal plan (ulid
	// order — listMealServices() is already sorted ascending by _id).
	async getMealServiceByPlanId(mealPlanId: string): Promise<MealService | null> {
		const services = await this.listMealServices();
		const matches = services.filter((s) => s.meal_plan_id === mealPlanId);
		return matches.length > 0 ? matches[matches.length - 1] : null;
	}

	// Finds first meal service matching date and meal period. Prefer getMealServiceByPlanId.
	async getMealService(date: string, meal: string): Promise<MealService | null> {
		const services = await this.listMealServices();
		return services.find((s) => s.date === date && s.meal === meal) ?? null;
	}

	listMealServices(): Promise<MealService[]> {
		return this.repo.allByType('meal_service', isMealService);
	}

	// Ensures only one receipt decision exists per meal_service (idempotency guard).
	private async assertNoExistingReceipt(mealServiceId: string): Promise<void> {
		const receipts = await this.listMealServiceReceipts();
		if (receipts.some((r) => r.meal_service_id === mealServiceId)) {
			throw new Error(`meal_service ${mealServiceId} already has a receipt decision`);
		}
	}

	async confirmMealServiceReceipt(
		mealServiceId: string,
		ctx: AuthorContext
	): Promise<MealServiceReceipt> {
		await this.assertNoExistingReceipt(mealServiceId);
		return this.repo.put(createMealServiceReceipt(mealServiceId, 'confirmed', ctx));
	}

	async confirmMealServiceReceiptWithYield(
		service: MealService,
		lines: readonly ResolvedYieldLine[],
		ctx: AuthorContext
	): Promise<{ receipt: MealServiceReceipt; ledger: StockLedger[] }> {
		if (lines.length === 0) {
			throw new Error('confirmMealServiceReceiptWithYield: at least one line is required');
		}
		await this.assertNoExistingReceipt(service._id);

		// The same item at the same point collapses to one row, so each row has
		// exactly one derived id. A later retry of this call derives the same ids.
		const merged = mergeYieldLines(lines);
		const expiry = kitchenYieldExpiry(service);
		const entries = await Promise.all(
			merged.map(async (line) =>
				createStockLedger(
					{
						item_id: line.item_id,
						qty: line.qty,
						unit: line.unit,
						reason: 'receive',
						ref_id: service._id,
						lot: {
							expiry,
							note: line.item_name,
							...storageLotFields(line.storage_point ?? null)
						}
					},
					ctx,
					await deriveDeterministicLedgerId(
						'kitchen_yield',
						service._id,
						line.item_id,
						line.storage_point?.id ?? ''
					)
				)
			)
		);

		// A row left by an earlier attempt (ledger written, receipt not) is not
		// written again; one that disagrees with what we are about to write means
		// the lines changed under a retry, which must not silently double-count.
		const pending: StockLedger[] = [];
		const received: StockLedger[] = [];
		for (const entry of entries) {
			const existing = await this.repo.get<StockLedger>(entry._id);
			if (!existing) {
				pending.push(entry);
				continue;
			}
			if (existing.item_id !== entry.item_id || existing.qty !== entry.qty) {
				throw new Error(
					`confirmMealServiceReceiptWithYield: ${entry._id} already holds ${existing.qty} of ${existing.item_id}`
				);
			}
			received.push(existing);
		}

		const receipt = createMealServiceReceipt(service._id, 'confirmed', ctx);
		await bulkDocs(this.dbName, [...pending, receipt]);
		return { receipt, ledger: [...received, ...pending] };
	}

	async rejectMealServiceReceipt(
		mealServiceId: string,
		reason: string,
		ctx: AuthorContext
	): Promise<MealServiceReceipt> {
		await this.assertNoExistingReceipt(mealServiceId);
		return this.repo.put(createMealServiceReceipt(mealServiceId, 'rejected', ctx, reason));
	}

	listMealServiceReceipts(): Promise<MealServiceReceipt[]> {
		return this.repo.allByType('meal_service_receipt', isMealServiceReceipt);
	}

	async confirmMealPlan(plan: MealPlan): Promise<MealPlan> {
		if (plan.status !== 'draft') {
			throw new Error('confirmMealPlan: only draft plans can be confirmed');
		}
		return this.repo.put({ ...touch(plan), status: 'confirmed' });
	}

	async startMealPlanCooking(
		plan: MealPlan,
		cookingStartedAt: NonNullable<MealPlan['cooking_started_at']>
	): Promise<MealPlan> {
		return this.repo.put({ ...touch(plan), cooking_started_at: cookingStartedAt });
	}

	async updateMealPlanDraft(
		plan: MealPlan,
		patch: Pick<MealPlan, 'headcount' | 'recipes' | 'calc_source' | 'override_reason' | 'label'>
	): Promise<MealPlan> {
		if (plan.status !== 'draft') {
			throw new Error('updateMealPlanDraft: only draft plans can be edited');
		}
		const next = { ...touch(plan), ...patch };
		// Delete keys explicitly set to undefined in patch.
		if (patch.label === undefined) delete next.label;
		return this.repo.put(next);
	}

	async updateConfirmedMealPlan(
		plan: MealPlan,
		patch: Pick<
			MealPlan,
			'headcount' | 'recipes' | 'calc_source' | 'label' | 'target_tags' | 'allocated_target'
		>
	): Promise<MealPlan> {
		if (plan.status !== 'confirmed') {
			throw new Error('updateConfirmedMealPlan: only confirmed plans can be edited this way');
		}
		const next = { ...touch(plan), ...patch };
		if (patch.label === undefined) delete next.label;
		return this.repo.put(next);
	}

	async deleteMealPlanDraft(plan: MealPlan): Promise<void> {
		if (plan.status !== 'draft') {
			throw new Error('deleteMealPlanDraft: only draft plans can be deleted');
		}
		await this.repo.remove(plan);
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
