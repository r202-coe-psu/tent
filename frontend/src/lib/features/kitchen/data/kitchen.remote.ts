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
	createGasCylinderType,
	gasCylinderTypeInputSchema,
	isMealPlan,
	isKitchenRequisition,
	isMealService,
	isGasCylinderType,
	isMealSession,
	type MealPlan,
	type MealPlanInput,
	type KitchenRequisition,
	type KitchenRequisitionInput,
	type MealService,
	type MealServiceInput,
	type GasCylinderType,
	type GasCylinderTypeInput,
	type MealSession,
	type MealSessionInput,
	type KitchenCounter
} from '../domain/kitchen';
import { formatTicketNo } from '../domain/meal-calc';
import {
	createGasLedgerEntry,
	isGasLedgerEntry,
	gasCylinderBalance,
	maxRefillKg,
	type GasLedgerEntry
} from '../domain/gas-ledger';
import {
	createStockLedger,
	stockBalance,
	isStockLedger,
	type StockLedger
} from '$lib/features/operations';
import { persistQty, qtyGt, qtyLte, qtyNeg } from '$lib/utils/qty';
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

		// Verify sufficient gas cylinder balance for planned consumption.
		const plan = input.meal_plan_id ? await this.getMealPlanById(input.meal_plan_id) : null;
		const gasUsage = plan?.gas_usage ?? [];
		if (gasUsage.length > 0) {
			const [types, gasLedger] = await Promise.all([
				this.listGasCylinderTypes(),
				this.listGasLedger()
			]);
			for (const g of gasUsage) {
				const cyl = types.find((t) => t._id === g.cylinder_id);
				if (!cyl) {
					throw new Error(`issueRequisition: gas cylinder ${g.cylinder_id} not found`);
				}
				const remaining = gasCylinderBalance(gasLedger, g.cylinder_id, cyl.capacity_kg);
				if (qtyGt(g.consumption_kg, remaining)) {
					throw new Error(
						`issueRequisition: cannot draw ${g.consumption_kg} kg from "${cyl.name}" — only ${remaining} kg remaining`
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
		const gasLedgerEntries = gasUsage.map((g) =>
			createGasLedgerEntry(
				{
					cylinder_id: g.cylinder_id,
					qty_kg: qtyNeg(g.consumption_kg),
					reason: 'consumption',
					ref_id: requisition._id
				},
				ctx
			)
		);

		await bulkDocs(this.dbName, [requisition, ...ledgerEntries, ...gasLedgerEntries]);
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
		for (let attempt = 0; attempt < 5; attempt++) {
			let counterDoc: KitchenCounter;
			let nextSeq: number;
			const existingCounter = await this.repo.get<KitchenCounter>('kitchen_counter:main');
			if (existingCounter) {
				nextSeq = existingCounter.seq + 1;
				counterDoc = {
					...existingCounter,
					seq: nextSeq,
					updated_at: now()
				};
			} else {
				nextSeq = 1;
				counterDoc = {
					_id: 'kitchen_counter:main',
					type: 'kitchen_counter',
					schema_v: 1,
					shelter_code: ctx.shelterCode,
					seq: 1,
					created_at: now(),
					updated_at: now(),
					created_by: ctx.createdBy ?? 'kitchen_staff'
				};
			}

			const ticketNo = formatTicketNo(ctx.shelterCode, nextSeq);

			let planDoc: MealPlan | undefined;
			if (params.planInput) {
				planDoc = createMealPlan(params.planInput, ctx);
			}

			const mealPlanId = planDoc ? planDoc._id : (params.requisitionInput.meal_plan_id ?? null);
			const requisitionDoc = createPendingRequisition(
				{
					...params.requisitionInput,
					meal_plan_id: mealPlanId,
					ticket_no: ticketNo
				},
				ctx
			);

			const docsToWrite = [counterDoc, ...(planDoc ? [planDoc] : []), requisitionDoc];
			try {
				await bulkDocs(this.dbName, docsToWrite);
				return { plan: planDoc, requisition: requisitionDoc };
			} catch (err: unknown) {
				const errorObj = err as { status?: number; message?: string } | null;
				if (errorObj?.status === 409 || errorObj?.message?.includes('conflict')) {
					continue;
				}
				throw err;
			}
		}
		throw new Error(
			'createPendingRequisition: failed to allocate ticket number after 5 retries due to MVCC conflict'
		);
	}

	async approveRequisitionTicket(
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
			throw new Error(`approveRequisitionTicket: requisition ${requisitionId} not found`);
		}
		if (requisition.status !== 'pending') {
			throw new Error(
				`approveRequisitionTicket: ticket ${requisition.ticket_no} is already ${requisition.status}`
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

		// 2. Update gas_drawdown if switched_gas provided
		let updatedGas = requisition.gas_drawdown ?? [];
		if (options?.switched_gas && options.switched_gas.length > 0) {
			updatedGas = options.switched_gas.map((g) => ({
				cylinder_id: g.cylinder_id,
				qty_kg: persistQty(g.qty_kg)
			}));
		}

		// 3. Check stock balance
		const issuedItems = updatedItems.filter((i) => qtyGt(i.qty_issued, '0'));
		if (issuedItems.length > 0) {
			const ledger = await this.repo.allByType<StockLedger>('stock_ledger', isStockLedger);
			const balance = stockBalance(ledger);
			for (const item of issuedItems) {
				const onHand = balance.get(item.item_id) ?? '0';
				if (qtyGt(item.qty_issued, onHand)) {
					throw new Error(
						`approveRequisitionTicket: cannot issue ${item.qty_issued} ${item.unit} of ${item.item_id} — only ${onHand} on hand`
					);
				}
			}
		}

		// 4. Check gas balance
		if (updatedGas.length > 0) {
			const [types, gasLedger] = await Promise.all([
				this.listGasCylinderTypes(),
				this.listGasLedger()
			]);
			for (const g of updatedGas) {
				const cyl = types.find((t) => t._id === g.cylinder_id);
				if (!cyl) {
					throw new Error(`approveRequisitionTicket: gas cylinder ${g.cylinder_id} not found`);
				}
				const remaining = gasCylinderBalance(gasLedger, g.cylinder_id, cyl.capacity_kg);
				if (qtyGt(g.qty_kg, remaining)) {
					throw new Error(
						`approveRequisitionTicket: cannot draw ${g.qty_kg} kg from "${cyl.name}" — only ${remaining} kg remaining`
					);
				}
			}
		}

		// 5. Generate stock ledger entries
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

		// 6. Generate gas ledger entries
		const gasLedgerEntries = updatedGas.map((g) =>
			createGasLedgerEntry(
				{
					cylinder_id: g.cylinder_id,
					qty_kg: qtyNeg(g.qty_kg),
					reason: 'consumption',
					ref_id: requisition._id
				},
				authCtx
			)
		);
		const gasLedgerIds = gasLedgerEntries.map((g) => g._id);
		const allLedgerIds = [...stockLedgerIds, ...gasLedgerIds];

		// 7. Update requisition doc
		const approvedRequisition: KitchenRequisition = {
			...requisition,
			status: 'approved',
			items: updatedItems,
			gas_drawdown: updatedGas,
			ledger_ids: allLedgerIds,
			approved_at: ts,
			approved_by: approver || authCtx.createdBy || 'warehouse_staff',
			updated_at: ts
		};

		// 8. If linked to meal_plan, confirm the meal_plan
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
			...gasLedgerEntries,
			...(confirmedPlan ? [confirmedPlan] : [])
		]);

		return approvedRequisition;
	}

	async rejectRequisitionTicket(
		requisitionId: string,
		reason: string,
		ctx: AuthorContext
	): Promise<KitchenRequisition> {
		void ctx;
		const requisition = await this.getKitchenRequisitionById(requisitionId);
		if (!requisition) {
			throw new Error(`rejectRequisitionTicket: requisition ${requisitionId} not found`);
		}
		if (requisition.status !== 'pending') {
			throw new Error(
				`rejectRequisitionTicket: ticket ${requisition.ticket_no} is already ${requisition.status}`
			);
		}
		const rejectedRequisition: KitchenRequisition = {
			...touch(requisition),
			status: 'rejected',
			reject_reason: reason
		};
		return this.repo.put(rejectedRequisition);
	}

	// Ensures only one meal service record exists per meal plan.
	async recordMealService(input: MealServiceInput, ctx: AuthorContext): Promise<MealService> {
		if (input.meal_plan_id) {
			const existing = await this.getMealServiceByPlanId(input.meal_plan_id);
			if (existing) {
				throw new Error('recordMealService: a service is already recorded for this meal plan');
			}
		}
		return this.repo.put(createMealService(input, ctx));
	}

	// Finds meal service recorded for a specific meal plan.
	async getMealServiceByPlanId(mealPlanId: string): Promise<MealService | null> {
		const services = await this.listMealServices();
		return services.find((s) => s.meal_plan_id === mealPlanId) ?? null;
	}

	// Finds first meal service matching date and meal period. Prefer getMealServiceByPlanId.
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
		patch: Pick<
			MealPlan,
			'headcount' | 'recipes' | 'calc_source' | 'override_reason' | 'label' | 'gas_usage'
		>
	): Promise<MealPlan> {
		if (plan.status !== 'draft') {
			throw new Error('updateMealPlanDraft: only draft plans can be edited');
		}
		const next = { ...touch(plan), ...patch };
		// Delete keys explicitly set to undefined in patch.
		if (patch.label === undefined) delete next.label;
		if (patch.gas_usage === undefined) delete next.gas_usage;
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

	listGasLedger(): Promise<GasLedgerEntry[]> {
		return this.repo.allByType('gas_ledger', isGasLedgerEntry);
	}

	async refillGasCylinder(
		cylinderId: string,
		qtyKg: string,
		ctx: AuthorContext
	): Promise<GasLedgerEntry> {
		const [types, gasLedger] = await Promise.all([
			this.listGasCylinderTypes(),
			this.listGasLedger()
		]);
		const cyl = types.find((t) => t._id === cylinderId);
		if (!cyl) {
			throw new Error(`refillGasCylinder: cylinder ${cylinderId} not found`);
		}
		const remaining = gasCylinderBalance(gasLedger, cylinderId, cyl.capacity_kg);
		const room = maxRefillKg(remaining, cyl.capacity_kg);
		if (qtyGt(qtyKg, room)) {
			throw new Error(
				`refillGasCylinder: refilling ${qtyKg} kg would exceed "${cyl.name}"'s capacity — only ${room} kg of room left`
			);
		}
		return this.repo.put(
			createGasLedgerEntry({ cylinder_id: cylinderId, qty_kg: qtyKg, reason: 'refill' }, ctx)
		);
	}

	async writeOffGasCylinder(cylinderId: string, ctx: AuthorContext): Promise<GasLedgerEntry> {
		const [types, gasLedger] = await Promise.all([
			this.listGasCylinderTypes(),
			this.listGasLedger()
		]);
		const cyl = types.find((t) => t._id === cylinderId);
		if (!cyl) {
			throw new Error(`writeOffGasCylinder: cylinder ${cylinderId} not found`);
		}
		const remaining = gasCylinderBalance(gasLedger, cylinderId, cyl.capacity_kg);
		if (qtyLte(remaining, 0)) {
			throw new Error(`writeOffGasCylinder: "${cyl.name}" is already empty — nothing to write off`);
		}
		return this.repo.put(
			createGasLedgerEntry(
				{ cylinder_id: cylinderId, qty_kg: qtyNeg(remaining), reason: 'adjust' },
				ctx
			)
		);
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
