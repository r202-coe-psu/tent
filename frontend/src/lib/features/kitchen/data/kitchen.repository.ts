import type {
	MealSession,
	MealSessionInput,
	MealPlan,
	MealPlanInput,
	KitchenRequisition,
	KitchenRequisitionInput,
	MealService,
	MealServiceInput,
	MealServiceReceipt
} from '../domain/kitchen';
import type { ResolvedYieldLine } from '../domain/kitchen-yield-receipt';
import type { StockLedger } from '$lib/features/operations';
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
	};
}

export interface ApproveRequisitionOptions {
	partial_items?: Array<{ item_id: string; qty_issued: string }>;
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
			| 'meal_session_id'
			| 'target_tags'
			| 'allocated_target'
		>
	): Promise<MealPlan>;
	startMealPlanCooking(
		plan: MealPlan,
		cookingStartedAt: NonNullable<MealPlan['cooking_started_at']>
	): Promise<MealPlan>;
	deleteMealPlanDraft(plan: MealPlan): Promise<void>;
	// Confirmed plans (a ticket already references them) — only while that
	// ticket is still PENDING_PICK; caller enforces the ticket-status guard by
	// updating the ticket's items first (CR-142).
	updateConfirmedMealPlan(
		plan: MealPlan,
		patch: Pick<
			MealPlan,
			'headcount' | 'recipes' | 'calc_source' | 'label' | 'target_tags' | 'allocated_target'
		>
	): Promise<MealPlan>;

	// KitchenRequisition — State Machine (pending -> approved | rejected)
	createPendingRequisition(
		params: CreatePendingRequisitionParams,
		ctx: AuthorContext
	): Promise<{ plan?: MealPlan; requisition: KitchenRequisition }>;
	approveKitchenRequisition(
		requisitionId: string,
		approver: string,
		options?: ApproveRequisitionOptions,
		ctx?: AuthorContext
	): Promise<KitchenRequisition>;
	rejectKitchenRequisition(
		requisitionId: string,
		reason: string,
		ctx: AuthorContext
	): Promise<KitchenRequisition>;
	getKitchenRequisitionById(id: string): Promise<KitchenRequisition | null>;

	// Issues requisition and records associated stock ledger entries.
	issueRequisition(input: KitchenRequisitionInput, ctx: AuthorContext): Promise<KitchenRequisition>;
	listRequisitions(): Promise<KitchenRequisition[]>;

	// MealService — ulid _id, append-only; recordMealService rejects a second
	// service for a plan whose latest service hasn't been rejected (CR-145) — a
	// rejected service may be superseded by re-recording.
	recordMealService(input: MealServiceInput, ctx: AuthorContext): Promise<MealService>;
	/** Latest meal_service for a plan (ulid order) — a plan may have more than
	 * one after a reject-and-redo cycle (CR-145). */
	getMealServiceByPlanId(mealPlanId: string): Promise<MealService | null>;
	/** @deprecated Ambiguous with multiple plans per date+meal — use getMealServiceByPlanId. */
	getMealService(date: string, meal: string): Promise<MealService | null>;
	listMealServices(): Promise<MealService[]>;

	// MealServiceReceipt (CR-144/CR-145) — warehouse confirms or rejects receipt
	// of cooked output; append-only, rejects a second decision for a meal_service
	// that already has one.
	confirmMealServiceReceipt(mealServiceId: string, ctx: AuthorContext): Promise<MealServiceReceipt>;
	/**
	 * Confirm receipt AND take the cooked food into stock: one
	 * `stock_ledger` row per (item, storage point) plus the confirmed receipt,
	 * written together. Ledger ids are derived from the meal_service so a retry
	 * never receives the same food twice.
	 */
	confirmMealServiceReceiptWithYield(
		service: MealService,
		lines: readonly ResolvedYieldLine[],
		ctx: AuthorContext
	): Promise<{ receipt: MealServiceReceipt; ledger: StockLedger[] }>;
	rejectMealServiceReceipt(
		mealServiceId: string,
		reason: string,
		ctx: AuthorContext
	): Promise<MealServiceReceipt>;
	listMealServiceReceipts(): Promise<MealServiceReceipt[]>;
}
