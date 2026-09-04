import type {
	MealSession,
	MealSessionInput,
	MealPlan,
	MealPlanInput,
	KitchenRequisition,
	KitchenRequisitionInput,
	MealService,
	MealServiceInput,
	GasCylinderType,
	GasCylinderTypeInput
} from '../domain/kitchen';
import type { GasLedgerEntry } from '../domain/gas-ledger';
import type { AuthorContext } from '$lib/db/model';

export interface CreatePendingRequisitionParams {
	planInput?: MealPlanInput;
	requisitionInput: {
		meal_plan_id?: string | null;
		meal_session_id?: string | null;
		items: Array<{
			item_id: string;
			qty_requested: string;
			qty_issued?: string;
			unit: string;
		}>;
		gas_drawdown?: Array<{
			cylinder_id: string;
			qty_kg: string;
		}>;
	};
}

export interface ApproveRequisitionOptions {
	partial_items?: Array<{ item_id: string; qty_issued: string }>;
	switched_gas?: Array<{ cylinder_id: string; qty_kg: string }>;
}

export interface KitchenRepository {
	// MealSession — 2-tier session management
	createMealSession(input: MealSessionInput, ctx: AuthorContext): Promise<MealSession>;
	getMealSessionById(id: string): Promise<MealSession | null>;
	listMealSessions(): Promise<MealSession[]>;
	updateMealSession(session: MealSession, patch: Partial<MealSessionInput>): Promise<MealSession>;
	deleteMealSession(session: MealSession): Promise<void>;

	// MealPlan — ulid _id; multiple plans may share a date+meal (extra batches)
	createMealPlan(input: MealPlanInput, ctx: AuthorContext): Promise<MealPlan>;
	getMealPlanById(id: string): Promise<MealPlan | null>;
	/** @deprecated Ambiguous with multiple plans per date+meal — use getMealPlanById. */
	getMealPlan(date: string, meal: string): Promise<MealPlan | null>;
	listMealPlans(): Promise<MealPlan[]>;
	confirmMealPlan(plan: MealPlan): Promise<MealPlan>;
	// Draft-only — a confirmed plan may already be requisitioned/serviced, so
	// editing or deleting it would orphan those records' meal_plan_id reference.
	updateMealPlanDraft(
		plan: MealPlan,
		patch: Pick<
			MealPlan,
			| 'headcount'
			| 'recipes'
			| 'calc_source'
			| 'override_reason'
			| 'label'
			| 'gas_usage'
			| 'meal_session_id'
			| 'target_tags'
			| 'allocated_target'
		>
	): Promise<MealPlan>;
	deleteMealPlanDraft(plan: MealPlan): Promise<void>;

	// KitchenRequisition — State Machine (pending -> approved | rejected)
	createPendingRequisition(
		params: CreatePendingRequisitionParams,
		ctx: AuthorContext
	): Promise<{ plan?: MealPlan; requisition: KitchenRequisition }>;
	approveRequisitionTicket(
		requisitionId: string,
		approver: string,
		options?: ApproveRequisitionOptions,
		ctx?: AuthorContext
	): Promise<KitchenRequisition>;
	rejectRequisitionTicket(
		requisitionId: string,
		reason: string,
		ctx: AuthorContext
	): Promise<KitchenRequisition>;
	getKitchenRequisitionById(id: string): Promise<KitchenRequisition | null>;

	// Issues requisition and records associated stock and gas ledger entries.
	issueRequisition(input: KitchenRequisitionInput, ctx: AuthorContext): Promise<KitchenRequisition>;
	listRequisitions(): Promise<KitchenRequisition[]>;

	// MealService — ulid _id, append-only; recordMealService rejects a second
	// service for a plan that already has one (one-shot per meal_plan_id).
	recordMealService(input: MealServiceInput, ctx: AuthorContext): Promise<MealService>;
	getMealServiceByPlanId(mealPlanId: string): Promise<MealService | null>;
	/** @deprecated Ambiguous with multiple plans per date+meal — use getMealServiceByPlanId. */
	getMealService(date: string, meal: string): Promise<MealService | null>;
	listMealServices(): Promise<MealService[]>;

	// Gas cylinder type configuration.
	createGasCylinderType(input: GasCylinderTypeInput, ctx: AuthorContext): Promise<GasCylinderType>;
	listGasCylinderTypes(): Promise<GasCylinderType[]>;
	updateGasCylinderType(
		doc: GasCylinderType,
		input: GasCylinderTypeInput
	): Promise<GasCylinderType>;
	deleteGasCylinderType(doc: GasCylinderType): Promise<void>;

	// Gas ledger operations.
	listGasLedger(): Promise<GasLedgerEntry[]>;
	refillGasCylinder(cylinderId: string, qtyKg: string, ctx: AuthorContext): Promise<GasLedgerEntry>;
	// Writes off remaining gas balance to zero. Throws if cylinder is already empty.
	writeOffGasCylinder(cylinderId: string, ctx: AuthorContext): Promise<GasLedgerEntry>;
}
