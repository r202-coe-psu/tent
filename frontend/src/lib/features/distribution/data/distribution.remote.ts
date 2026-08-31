import { allDocsByType, getDoc, putDoc, putDocStrict } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { now, type AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { addQty, persistQty, qtyGt, qtyNeg, subQty } from '$lib/utils/qty';
import { isSystemAdmin, isWarehouseStaff } from '$lib/auth/roles';
import {
	createDistributionBatch,
	createDistributionRequest,
	createStockLotReservation,
	distributionBatchDocSchema,
	type DistributionAllocation,
	type DistributionBatch,
	type DistributionBatchItem,
	type DistributionBatchStatus,
	type DistributionRequest,
	type DistributionRequestInput,
	type DistributionRequestStatus,
	type StockLotReservation
} from '../domain/distribution';
import {
	createStockLedger,
	isStockLedger,
	projectStockLotBalances,
	parseStockLedger,
	type StockLotBalance,
	type StockLedger
} from '$lib/features/operations/domain/operations';
import type {
	DistributionAllocationInput,
	DistributionRepository
} from './distribution.repository';
import {
	ApprovalConflictError,
	assertSemanticBatchMatch,
	assertSemanticLedgerMatch,
	InsufficientStockError,
	IntegrityError,
	makeLotReservationDocId,
	ValidationError
} from './semantic-verify';

function isDistributionRequest(d: unknown): d is DistributionRequest {
	return (
		typeof d === 'object' &&
		d !== null &&
		(d as { type?: string }).type === 'distribution_request' &&
		typeof (d as { _id?: string })._id === 'string'
	);
}

function isDistributionBatch(d: unknown): d is DistributionBatch {
	return (
		typeof d === 'object' &&
		d !== null &&
		(d as { type?: string }).type === 'distribution_batch' &&
		typeof (d as { _id?: string })._id === 'string'
	);
}

type CanonicalPlan = {
	allocations: DistributionAllocation[];
	items: DistributionBatchItem[];
};

export class DistributionRemoteRepository implements DistributionRepository {
	private readonly dbName: string;

	constructor(dbName: string = getShelterDb()) {
		this.dbName = dbName;
	}

	private assertAuthorizedStaff(ctx: AuthorContext, action: string): void {
		if (!ctx.roles || (!isWarehouseStaff(ctx.roles) && !isSystemAdmin(ctx.roles))) {
			throw new Error(
				`Unauthorized: distribution ${action} requires warehouse_staff or system_admin role`
			);
		}
	}

	private async releaseClaimWithRetry(
		lotRef: string,
		operationId: string,
		maxRetries = 3
	): Promise<void> {
		const resId = await makeLotReservationDocId(lotRef);
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const resDoc = await getDoc<StockLotReservation>(this.dbName, resId);
				if (!resDoc) return;
				const hasMyClaim = resDoc.pending_claims.some((c) => c.operation_id === operationId);
				if (!hasMyClaim) return;

				const remaining = resDoc.pending_claims.filter((c) => c.operation_id !== operationId);
				await putDocStrict<StockLotReservation>(this.dbName, {
					...resDoc,
					pending_claims: remaining,
					updated_at: now()
				});
				const confirmed = await getDoc<StockLotReservation>(this.dbName, resId);
				if (!confirmed || !confirmed.pending_claims.some((c) => c.operation_id === operationId)) {
					return;
				}
				if (attempt === maxRetries) {
					throw new IntegrityError(
						`Reservation claim for ${operationId} remains after cleanup on ${lotRef}`
					);
				}
			} catch (err) {
				if (attempt === maxRetries) {
					throw err;
				}
			}
		}
	}

	private async loadPhysicalLots(): Promise<StockLotBalance[]> {
		const ledgers = await allDocsByType<StockLedger>(this.dbName, 'stock_ledger', isStockLedger);
		return projectStockLotBalances(ledgers);
	}

	private async assertPhysicalLot(
		lotRef: string,
		itemId: string,
		unit: string,
		ctx: AuthorContext,
		lots?: readonly StockLotBalance[]
	): Promise<StockLotBalance> {
		const balances = lots ?? (await this.loadPhysicalLots());
		const physicalLot = balances.find((lot) => lot.lot_ref === lotRef);
		if (!physicalLot) throw new ValidationError(`Physical lot ${lotRef} does not exist`);
		if (physicalLot.item_id !== itemId) {
			throw new ValidationError(`Physical lot ${lotRef} does not match item ${itemId}`);
		}
		if (physicalLot.unit !== unit) {
			throw new ValidationError(`Physical lot ${lotRef} does not match unit ${unit}`);
		}

		// A physical lot is created by the inbound ledger identified by lot_ref.
		// This direct read preserves legacy self-ID lots while never using lot_no as identity.
		const source = await getDoc<StockLedger>(this.dbName, lotRef);
		if (!source || !isStockLedger(source)) {
			throw new IntegrityError(`Physical lot source ${lotRef} is missing or malformed`);
		}
		const parsedSource = parseStockLedger(source);
		if (
			parsedSource.shelter_code !== ctx.shelterCode ||
			parsedSource.item_id !== itemId ||
			parsedSource.unit !== unit ||
			!qtyGt(parsedSource.qty, 0)
		) {
			throw new IntegrityError(
				`Physical lot ${lotRef} is outside the approved item, unit, or shelter`
			);
		}
		return physicalLot;
	}

	private deriveBatchItems(
		req: DistributionRequest,
		allocations: readonly DistributionAllocation[]
	): DistributionBatchItem[] {
		const totals = new Map<string, string>();
		for (const allocation of allocations) {
			totals.set(allocation.item_id, addQty(totals.get(allocation.item_id) ?? '0', allocation.qty));
		}
		return req.items.flatMap((item) => {
			const qty = totals.get(item.item_id);
			if (!qty || !qtyGt(qty, 0)) return [];
			return [
				{
					item_id: item.item_id,
					allocated_qty: persistQty(qty),
					unit: item.unit,
					distribution_type_snapshot: item.distribution_type_snapshot
				}
			];
		});
	}

	private async canonicalizeAllocations(
		rawAllocations: DistributionAllocationInput[],
		req: DistributionRequest,
		approvalOperationId: string,
		ctx: AuthorContext
	): Promise<CanonicalPlan> {
		if (!rawAllocations.length) {
			throw new ValidationError('Approval must contain at least one positive allocation');
		}
		const lots = await this.loadPhysicalLots();
		const seenLotKeys = new Set<string>();
		const itemTotals = new Map<string, string>();
		const normalized = rawAllocations.map((allocation) => ({
			...allocation,
			qty: persistQty(allocation.qty)
		}));

		for (const allocation of normalized) {
			if (!qtyGt(allocation.qty, 0)) {
				throw new ValidationError('Allocation quantity must be positive');
			}
			const reqItem = req.items.find((item) => item.item_id === allocation.item_id);
			if (!reqItem) {
				throw new ValidationError(`Allocated item ${allocation.item_id} not found in request`);
			}
			const key = `${allocation.item_id}:${allocation.lot_ref}`;
			if (seenLotKeys.has(key)) {
				throw new ValidationError(`Duplicate allocation line for item and lot: ${key}`);
			}
			seenLotKeys.add(key);
			await this.assertPhysicalLot(allocation.lot_ref, allocation.item_id, reqItem.unit, ctx, lots);
			itemTotals.set(
				allocation.item_id,
				addQty(itemTotals.get(allocation.item_id) ?? '0', allocation.qty)
			);
		}

		for (const [itemId, qty] of itemTotals) {
			const reqItem = req.items.find((item) => item.item_id === itemId)!;
			if (qtyGt(qty, reqItem.requested_qty)) {
				throw new ValidationError(
					`Total allocated quantity ${qty} exceeds requested quantity ${reqItem.requested_qty} for item ${itemId}`
				);
			}
		}

		const allocations = normalized
			.sort((a, b) => a.lot_ref.localeCompare(b.lot_ref) || a.item_id.localeCompare(b.item_id))
			.map((allocation, index) => ({
				item_id: allocation.item_id,
				lot_ref: allocation.lot_ref,
				lot: allocation.lot ?? {},
				qty: allocation.qty,
				allocation_ledger_id: `stock_ledger:${approvalOperationId}:${index}`
			}));
		return { allocations, items: this.deriveBatchItems(req, allocations) };
	}

	private async assertPersistedBatch(
		batch: unknown,
		req: DistributionRequest,
		approvalOperationId: string,
		ctx: AuthorContext
	): Promise<DistributionBatch> {
		const parsed = distributionBatchDocSchema.safeParse(batch);
		if (!parsed.success) throw new IntegrityError('Persisted distribution batch is malformed');
		const persisted = parsed.data as DistributionBatch;
		const expectedId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
		if (
			persisted._id !== expectedId ||
			persisted.request_id !== req._id ||
			persisted.shelter_code !== ctx.shelterCode ||
			(persisted.status !== 'activating' && persisted.status !== 'active')
		) {
			throw new IntegrityError(
				`Persisted batch ${persisted._id} is incompatible with approval recovery`
			);
		}
		const ordered = [...persisted.allocations].sort(
			(a, b) => a.lot_ref.localeCompare(b.lot_ref) || a.item_id.localeCompare(b.item_id)
		);
		if (JSON.stringify(ordered) !== JSON.stringify(persisted.allocations)) {
			throw new IntegrityError(`Persisted batch ${persisted._id} allocations are not canonical`);
		}
		const lots = await this.loadPhysicalLots();
		const totals = new Map<string, string>();
		for (let index = 0; index < persisted.allocations.length; index++) {
			const allocation = persisted.allocations[index];
			const requestItem = req.items.find((item) => item.item_id === allocation.item_id);
			if (!requestItem)
				throw new IntegrityError(`Batch allocation item ${allocation.item_id} is not requested`);
			if (allocation.allocation_ledger_id !== `stock_ledger:${approvalOperationId}:${index}`) {
				throw new IntegrityError(
					`Batch allocation ${index} has an invalid deterministic ledger ID`
				);
			}
			await this.assertPhysicalLot(
				allocation.lot_ref,
				allocation.item_id,
				requestItem.unit,
				ctx,
				lots
			);
			totals.set(allocation.item_id, addQty(totals.get(allocation.item_id) ?? '0', allocation.qty));
		}
		for (const [itemId, qty] of totals) {
			const requestItem = req.items.find((item) => item.item_id === itemId)!;
			if (qtyGt(qty, requestItem.requested_qty)) {
				throw new IntegrityError(`Batch allocation for ${itemId} exceeds requested quantity`);
			}
		}
		const expectedItems = this.deriveBatchItems(req, persisted.allocations);
		assertSemanticBatchMatch(persisted, {
			_id: expectedId,
			request_id: req._id,
			shelter_code: ctx.shelterCode,
			items: expectedItems,
			allocations: persisted.allocations
		});
		return persisted;
	}

	private assertPlansMatch(
		caller: readonly DistributionAllocation[],
		persisted: readonly DistributionAllocation[]
	): void {
		if (
			caller.length !== persisted.length ||
			caller.some(
				(allocation, index) =>
					allocation.item_id !== persisted[index].item_id ||
					allocation.lot_ref !== persisted[index].lot_ref ||
					allocation.qty !== persisted[index].qty ||
					JSON.stringify(allocation.lot) !== JSON.stringify(persisted[index].lot)
			)
		) {
			throw new ApprovalConflictError(
				'Approval already in progress with different allocation plan'
			);
		}
	}

	private async rollbackBeforeForwardBoundary(req: DistributionRequest): Promise<void> {
		const current = await getDoc<DistributionRequest>(this.dbName, req._id);
		if (!current || current.status !== 'approving') return;
		await putDocStrict<DistributionRequest>(this.dbName, {
			...current,
			status: 'pending' as const,
			approval_operation_id: undefined,
			updated_at: now()
		});
	}

	private async assertBatchLedgers(
		batch: DistributionBatch,
		req: DistributionRequest,
		approvalOperationId: string,
		ctx: AuthorContext
	): Promise<void> {
		for (let index = 0; index < batch.allocations.length; index++) {
			const allocation = batch.allocations[index];
			const requestItem = req.items.find((item) => item.item_id === allocation.item_id);
			if (!requestItem)
				throw new IntegrityError(`Batch allocation item ${allocation.item_id} is not requested`);
			const ledgerId = `stock_ledger:${approvalOperationId}:${index}`;
			const ledger = await getDoc<StockLedger>(this.dbName, ledgerId);
			if (!ledger) throw new IntegrityError(`Deterministic ledger ${ledgerId} is missing`);
			assertSemanticLedgerMatch(ledger, {
				_id: ledgerId,
				item_id: allocation.item_id,
				qty: qtyNeg(allocation.qty),
				unit: requestItem.unit,
				reason: 'distribute',
				ref_id: batch._id,
				lot_ref: allocation.lot_ref,
				shelter_code: ctx.shelterCode
			});
		}
	}

	async createRequest(
		input: DistributionRequestInput,
		ctx: AuthorContext
	): Promise<DistributionRequest> {
		const doc = createDistributionRequest(input, ctx);
		return putDocStrict(this.dbName, doc);
	}

	async getRequest(id: string): Promise<DistributionRequest | null> {
		return getDoc<DistributionRequest>(this.dbName, id);
	}

	async listRequests(status?: DistributionRequestStatus): Promise<DistributionRequest[]> {
		const all = await allDocsByType<DistributionRequest>(
			this.dbName,
			'distribution_request',
			isDistributionRequest
		);
		if (!status) return all;
		return all.filter((r) => r.status === status);
	}

	async getBatch(id: string): Promise<DistributionBatch | null> {
		return getDoc<DistributionBatch>(this.dbName, id);
	}

	async listBatches(status?: DistributionBatchStatus): Promise<DistributionBatch[]> {
		const all = await allDocsByType<DistributionBatch>(
			this.dbName,
			'distribution_batch',
			isDistributionBatch
		);
		if (!status) return all;
		return all.filter((b) => b.status === status);
	}

	async rejectRequest(
		requestId: string,
		reason: string,
		ctx: AuthorContext
	): Promise<DistributionRequest> {
		this.assertAuthorizedStaff(ctx, 'rejection');
		const req = await this.getRequest(requestId);
		if (!req) throw new Error(`Request not found: ${requestId}`);
		if (req.shelter_code !== ctx.shelterCode) throw new Error('Cross-shelter access denied');
		if (req.status !== 'pending') {
			throw new ValidationError(`Cannot reject request in status ${req.status}`);
		}
		if (!reason.trim()) {
			throw new ValidationError('Rejection reason is required');
		}

		const updated: DistributionRequest = {
			...req,
			status: 'rejected' as const,
			rejected_by: ctx.createdBy,
			rejected_at: now(),
			rejection_reason: reason.trim(),
			updated_at: now()
		};
		return putDocStrict(this.dbName, updated);
	}

	async approveRequest(
		requestId: string,
		rawAllocations: DistributionAllocationInput[],
		ctx: AuthorContext
	): Promise<DistributionBatch> {
		this.assertAuthorizedStaff(ctx, 'approval');
		const initialReq = await this.getRequest(requestId);
		if (!initialReq) throw new Error(`Request not found: ${requestId}`);
		if (initialReq.shelter_code !== ctx.shelterCode) throw new Error('Cross-shelter access denied');

		let req: DistributionRequest = initialReq;
		const requestUlid = req._id.slice('distribution_request:'.length);
		const batchId = `distribution_batch:${requestUlid}`;

		// 1. Terminal / idempotent check (Checkpoint J recovery)
		if (req.status === 'approved') {
			if (!req.batch_id) throw new IntegrityError(`Approved request ${req._id} missing batch_id`);
			if (!req.approval_operation_id) {
				throw new IntegrityError(`Approved request ${req._id} missing approval_operation_id`);
			}
			const existingBatchRaw = await this.getBatch(req.batch_id);
			if (!existingBatchRaw) throw new IntegrityError(`Batch ${req.batch_id} not found`);
			const existingBatch = await this.assertPersistedBatch(
				existingBatchRaw,
				req,
				req.approval_operation_id,
				ctx
			);
			if (existingBatch.status !== 'active') {
				throw new IntegrityError(
					`Batch ${req.batch_id} is in invalid status ${existingBatch.status} for approved request`
				);
			}

			if (
				existingBatch._id !== `distribution_batch:${requestUlid}` ||
				existingBatch.request_id !== req._id
			) {
				throw new IntegrityError(
					`Batch ${existingBatch._id} does not match approved request ${req._id}`
				);
			}

			const approvalOpId = req.approval_operation_id;

			await this.assertBatchLedgers(existingBatch, req, approvalOpId, ctx);

			// Safely remove any remaining claim for that operation via CAS with retry
			for (const alloc of existingBatch.allocations) {
				await this.releaseClaimWithRetry(alloc.lot_ref, approvalOpId, 3);
			}

			return existingBatch;
		}

		if (req.status !== 'pending' && req.status !== 'approving') {
			throw new ValidationError(`Cannot approve request in status: ${req.status}`);
		}

		// 2. Determine approval_operation_id
		let approvalOperationId: string;
		if (req.status === 'pending') {
			approvalOperationId = ulid();
			req = await putDocStrict<DistributionRequest>(this.dbName, {
				...req,
				status: 'approving' as const,
				approval_operation_id: approvalOperationId,
				updated_at: now()
			});
		} else {
			approvalOperationId = req.approval_operation_id!;
			if (!approvalOperationId) {
				throw new IntegrityError(`Approving request ${req._id} missing approval_operation_id`);
			}
		}

		// 3. Inspect deterministic batch if already existing.
		// After this point the persisted plan is authoritative, but never trusted blindly.
		const existingBatch = await this.getBatch(batchId);
		let batchDoc: DistributionBatch;
		let canonicalAllocations: DistributionAllocation[];

		if (existingBatch) {
			batchDoc = await this.assertPersistedBatch(existingBatch, req, approvalOperationId, ctx);
			canonicalAllocations = batchDoc.allocations;
			if (!rawAllocations?.length) {
				throw new ApprovalConflictError(
					'Approval already in progress with different allocation plan'
				);
			}
			const callerPlan = await this.canonicalizeAllocations(
				rawAllocations,
				req,
				approvalOperationId,
				ctx
			);
			this.assertPlansMatch(callerPlan.allocations, canonicalAllocations);
		} else {
			let plan: CanonicalPlan;
			try {
				plan = await this.canonicalizeAllocations(rawAllocations, req, approvalOperationId, ctx);
			} catch (err) {
				await this.rollbackBeforeForwardBoundary(req);
				throw err;
			}
			canonicalAllocations = plan.allocations;
			const batchItems = plan.items;

			// 5. Acquire Lot Claims via CAS (in sorted lot_ref order)
			// Group canonical allocations by lot_ref for atomic claim evaluation per lot
			const qtyByLot = new Map<string, string>();
			for (const alloc of canonicalAllocations) {
				const current = qtyByLot.get(alloc.lot_ref) ?? '0';
				qtyByLot.set(alloc.lot_ref, addQty(current, alloc.qty));
			}

			const sortedLotRefs = [...qtyByLot.keys()].sort((a, b) => a.localeCompare(b));
			const acquiredLots: string[] = [];

			try {
				for (const lotRef of sortedLotRefs) {
					const requiredQty = qtyByLot.get(lotRef)!;
					const lotAllocation = canonicalAllocations.find(
						(allocation) => allocation.lot_ref === lotRef
					)!;
					const resId = await makeLotReservationDocId(lotRef);

					let acquired = false;
					const maxRetries = 3;
					for (let attempt = 0; attempt <= maxRetries; attempt++) {
						// Re-read physical ledgers & balance projection on each attempt
						const allLedgers = await allDocsByType<StockLedger>(
							this.dbName,
							'stock_ledger',
							isStockLedger
						);
						const lotBalances = projectStockLotBalances(allLedgers);
						const physicalBalance = lotBalances.find((l) => l.lot_ref === lotRef)?.qty ?? '0';

						let resDoc = await getDoc<StockLotReservation>(this.dbName, resId);
						if (!resDoc) {
							resDoc = createStockLotReservation(
								{ lot_ref: lotRef, pending_claims: [] },
								resId.slice('stock_lot_reservation:'.length),
								ctx
							);
						}
						if (resDoc.lot_ref !== lotRef || resDoc.shelter_code !== ctx.shelterCode) {
							throw new IntegrityError(`Reservation ${resId} does not match physical lot scope`);
						}

						// Check if claim for approvalOperationId already exists
						const existingMyClaim = resDoc.pending_claims.find(
							(c) => c.operation_id === approvalOperationId
						);
						if (existingMyClaim) {
							if (
								existingMyClaim.request_id !== req._id ||
								existingMyClaim.batch_id !== batchId ||
								existingMyClaim.item_id !== lotAllocation.item_id ||
								existingMyClaim.lot_ref !== lotRef ||
								existingMyClaim.qty !== persistQty(requiredQty)
							) {
								throw new ApprovalConflictError(
									`Existing reservation claim for operation ${approvalOperationId} does not match expected payload`
								);
							}
							acquired = true;
							acquiredLots.push(lotRef);
							break;
						}

						const otherClaims = resDoc.pending_claims
							.filter((c) => c.operation_id !== approvalOperationId)
							.reduce((sum, c) => addQty(sum, c.qty), '0');

						const availableForClaim = subQty(physicalBalance, otherClaims);

						if (qtyGt(requiredQty, availableForClaim)) {
							throw new InsufficientStockError(
								`Physical lot balance exhausted by concurrent claims for ${lotRef}`
							);
						}

						const otherPending = resDoc.pending_claims.filter(
							(c) => c.operation_id !== approvalOperationId
						);
						const myClaim = {
							operation_id: approvalOperationId,
							request_id: req._id,
							batch_id: batchId,
							item_id: lotAllocation.item_id,
							lot_ref: lotRef,
							qty: persistQty(requiredQty),
							claimed_at: now()
						};

						resDoc = {
							...resDoc,
							pending_claims: [...otherPending, myClaim],
							updated_at: now()
						};

						try {
							await putDocStrict(this.dbName, resDoc);
							acquired = true;
							acquiredLots.push(lotRef);
							break;
						} catch (putErr) {
							if (attempt === maxRetries) {
								throw putErr;
							}
						}
					}
					if (!acquired) {
						throw new Error(`Failed to acquire reservation for ${lotRef} after retries`);
					}
				}
			} catch (err) {
				// Rollback acquired claims with CAS retry
				let allReleased = true;
				for (const lotRef of acquiredLots) {
					try {
						await this.releaseClaimWithRetry(lotRef, approvalOperationId, 3);
					} catch {
						allReleased = false;
					}
				}

				// Only revert request to pending if all acquired claims were confirmed released!
				if (
					allReleased &&
					!(err instanceof ApprovalConflictError) &&
					!(err instanceof IntegrityError)
				) {
					const currentReq = await getDoc<DistributionRequest>(this.dbName, req._id);
					if (currentReq && currentReq.status === 'approving') {
						await putDocStrict<DistributionRequest>(this.dbName, {
							...currentReq,
							status: 'pending' as const,
							approval_operation_id: undefined,
							updated_at: now()
						});
					}
				}
				throw err;
			}

			// 6. Persist activating batch (FORWARD-COMMIT BOUNDARY)
			const newBatch = createDistributionBatch(
				{
					request_id: req._id,
					items: batchItems,
					allocations: canonicalAllocations
				},
				ctx
			);

			batchDoc = await putDoc(this.dbName, newBatch, undefined, { onConflict: 'return-existing' });
			assertSemanticBatchMatch(batchDoc, {
				_id: batchId,
				request_id: req._id,
				shelter_code: ctx.shelterCode,
				items: batchItems,
				allocations: canonicalAllocations
			});
		}

		// 7. Write Deterministic Outbound Stock Ledgers
		for (let idx = 0; idx < canonicalAllocations.length; idx++) {
			const alloc = canonicalAllocations[idx];
			const ledgerIdSuffix = `${approvalOperationId}:${idx}`;
			const ledgerId = `stock_ledger:${ledgerIdSuffix}`;
			const reqItem = req.items.find((i) => i.item_id === alloc.item_id)!;

			const ledgerEntry = createStockLedger(
				{
					item_id: alloc.item_id,
					qty: qtyNeg(alloc.qty),
					unit: reqItem.unit,
					reason: 'distribute',
					ref_id: batchDoc._id,
					lot_ref: alloc.lot_ref,
					...(alloc.lot ? { lot: alloc.lot } : {})
				},
				ctx,
				ledgerIdSuffix
			);

			const writtenLedger = await putDoc(this.dbName, ledgerEntry, undefined, {
				onConflict: 'return-existing'
			});
			assertSemanticLedgerMatch(writtenLedger, {
				_id: ledgerId,
				item_id: alloc.item_id,
				qty: qtyNeg(alloc.qty),
				unit: reqItem.unit,
				reason: 'distribute',
				ref_id: batchDoc._id,
				lot_ref: alloc.lot_ref,
				shelter_code: ctx.shelterCode
			});
		}

		// 8. Post-write verification before activation and again immediately before approval.
		await this.assertBatchLedgers(batchDoc, req, approvalOperationId, ctx);

		// 9. CAS transition batch: activating -> active
		if (batchDoc.status === 'activating') {
			const currentBatch = await getDoc<DistributionBatch>(this.dbName, batchDoc._id);
			if (!currentBatch) throw new IntegrityError(`Activating batch ${batchDoc._id} is missing`);
			const verifiedCurrentBatch = await this.assertPersistedBatch(
				currentBatch,
				req,
				approvalOperationId,
				ctx
			);
			if (verifiedCurrentBatch.status === 'activating') {
				await putDocStrict<DistributionBatch>(this.dbName, {
					...verifiedCurrentBatch,
					status: 'active' as const,
					activated_at: now(),
					activated_by: ctx.createdBy,
					updated_at: now()
				});
			}
			const activated = await getDoc<DistributionBatch>(this.dbName, batchDoc._id);
			if (!activated) throw new IntegrityError(`Activated batch ${batchDoc._id} is missing`);
			batchDoc = await this.assertPersistedBatch(activated, req, approvalOperationId, ctx);
		}
		if (batchDoc.status !== 'active') {
			throw new IntegrityError(`Batch ${batchDoc._id} is not active after ledger verification`);
		}
		await this.assertPersistedBatch(batchDoc, req, approvalOperationId, ctx);
		await this.assertBatchLedgers(batchDoc, req, approvalOperationId, ctx);

		// 10. CAS transition request: approving -> approved
		const currentReq = await getDoc<DistributionRequest>(this.dbName, req._id);
		if (!currentReq) throw new IntegrityError(`Approving request ${req._id} is missing`);
		if (currentReq.status === 'approving') {
			await putDocStrict<DistributionRequest>(this.dbName, {
				...currentReq,
				status: 'approved' as const,
				batch_id: batchDoc._id,
				approved_by: ctx.createdBy,
				approved_at: now(),
				updated_at: now()
			});
		} else if (currentReq.status !== 'approved') {
			throw new IntegrityError(`Request ${req._id} left approving during approval finalization`);
		}

		// 11. Safely release reservation claims
		for (const alloc of canonicalAllocations) {
			await this.releaseClaimWithRetry(alloc.lot_ref, approvalOperationId, 3);
		}

		return batchDoc;
	}
}
