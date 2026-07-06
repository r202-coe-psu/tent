import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { makeDocId, now, touch, type AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { getShelterDb, shelterDb } from '$lib/db/shelter';
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
import type { KitchenRepository } from './kitchen.repository';

export class KitchenPouchRepository implements KitchenRepository {
	private readonly repo: Repository;

	constructor(dbName: string = getShelterDb()) {
		this.repo = createRepository(namedLocalDb(dbName));
	}

	// --- MealPlan ---

	createMealPlan(input: MealPlanInput, ctx: AuthorContext): Promise<MealPlan> {
		return this.repo.put(createMealPlan(input, ctx));
	}

	getMealPlan(date: string, meal: string): Promise<MealPlan | null> {
		return this.repo.get<MealPlan>(`meal_plan:${date}:${meal}`);
	}

	listMealPlans(): Promise<MealPlan[]> {
		return this.repo.allByType('meal_plan', isMealPlan);
	}

	// --- KitchenRequisition (bulkDocs pattern from spike §3) ---

	async issueRequisition(
		input: KitchenRequisitionInput,
		ctx: AuthorContext
	): Promise<KitchenRequisition> {
		const issuedItems = (input.items ?? []).filter((i) => (i.qty_issued ?? 0) > 0);

		// 1. Pre-generate IDs for each stock_ledger entry that will be written.
		//    Must happen before building the requisition doc (append-only → no updates).
		const ledgerIds = issuedItems.map(() => makeDocId('stock_ledger', ulid()));

		// 2. Build requisition with pre-populated ledger_ids.
		const requisition = createKitchenRequisition(input, ledgerIds, ctx);

		// 3. Build stock_ledger entries (qty negative = consumption, reason = 'requisition').
		const ts = now();
		const ledgerEntries = issuedItems.map((item, i) => ({
			_id: ledgerIds[i],
			type: 'stock_ledger' as const,
			schema_v: 1,
			shelter_code: ctx.shelterCode,
			created_at: ts,
			updated_at: ts,
			created_by: ctx.createdBy,
			item_id: item.item_id,
			qty: -item.qty_issued,
			unit: item.unit,
			reason: 'requisition' as const,
			ref_id: requisition._id,
			occurred_at: ts
		}));

		// 4. Write atomically. bulkDocs is not a true transaction — partial failure is
		//    possible. ULID IDs make a retry safe (409 conflict = already written).
		const db = shelterDb();
		const results = await db.bulkDocs([requisition, ...ledgerEntries]);

		const failures = results.filter(
			(r): r is PouchDB.Core.Error => 'error' in r && Boolean((r as PouchDB.Core.Error).error)
		);
		if (failures.length > 0) {
			throw new Error(`issueRequisition: ${failures.length} doc(s) failed to write`);
		}

		return requisition;
	}

	listRequisitions(): Promise<KitchenRequisition[]> {
		return this.repo.allByType('kitchen_requisition', isKitchenRequisition);
	}

	// --- MealService ---

	recordMealService(input: MealServiceInput, ctx: AuthorContext): Promise<MealService> {
		return this.repo.put(createMealService(input, ctx));
	}

	getMealService(date: string, meal: string): Promise<MealService | null> {
		return this.repo.get<MealService>(`meal_service:${date}:${meal}`);
	}

	listMealServices(): Promise<MealService[]> {
		return this.repo.allByType('meal_service', isMealService);
	}

	// Read-modify-write via the domain envelope: bump updated_at (LWW key) and
	// guard the state transition. Only draft → confirmed is legal.
	async confirmMealPlan(plan: MealPlan): Promise<MealPlan> {
		if (plan.status !== 'draft') {
			throw new Error('confirmMealPlan: only draft plans can be confirmed');
		}
		return this.repo.put({ ...touch(plan), status: 'confirmed' });
	}

	// --- GasCylinderType (mutable reference data, LWW via touch) ---

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
		singleton = new KitchenPouchRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
