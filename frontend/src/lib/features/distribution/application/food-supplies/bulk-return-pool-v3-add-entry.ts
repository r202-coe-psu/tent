import type { AuthorContext } from '$lib/db/model';
import { addQty, parseQty, subQty } from '$lib/utils/qty';
import { ConflictError } from '$lib/utils/errors';
import type {
	BulkReturnEntry,
	BulkReturnEntryLoanRef,
	BulkReturnEntryReturnerType
} from '../../domain/food-supplies';
import {
	allocateBulkReturnToLoans,
	canAppendToPool,
	createBulkReturnEntry,
	deriveEntryVoidId,
	deriveLoanReopenId,
	foldEntryMoves,
	isBulkReturnEligibleItem,
	resolveBulkReturnEntries,
	selectOutstandingLoans
} from '../../domain/food-supplies';
import { assertCanWriteBulkReturnEntry } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import {
	assertNoSkippedDocs,
	BulkReturnPoolLockTimeoutError,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	WorkflowValidationError
} from './errors';
import { assertPositiveIntegerQty } from './validation';
import {
	applyRefToLoanDetailed,
	assertOperationUlid,
	loadSnapshotPinsForWrite,
	outstandingLoansOf,
	requirePool,
	resolveDependencies,
	revertAppliedRefsIfReopened,
	settlePoolFence,
	type BulkReturnLoanSkipped,
	type BulkReturnPoolV3WorkflowDependencies,
	type LoanLike
} from './bulk-return-pool-v3-shared';

// ---------------------------------------------------------------------------------------------
// 3. add entries
// ---------------------------------------------------------------------------------------------

export type BulkReturnReturnerInput =
	{ type: 'evacuee' | 'volunteer'; id: string } | { type: 'unspecified' };

export interface AddBulkReturnEntriesInput {
	pool_id: string;
	returner: BulkReturnReturnerInput;
	items: { item_id: string; qty: string; operationUlid: string }[];
	notes?: string;
}

export interface AddBulkReturnEntryResult {
	entry: BulkReturnEntry;
	/** The pool stopped accepting entries before the loans were touched: move the entry out. */
	late: boolean;
	replayed: boolean;
	/**
	 * The entry is written but its pool stayed locked for a submit / cancel past the fence timeout, so
	 * no loan was touched (`loansApplied` is empty). The entry still counts in its pool; the loans are
	 * cut by retrying with the same operationUlid or by the pool's loan repair.
	 */
	loan_pending?: true;
	/**
	 * The entry was voided before its loans were cut and no submit snapshot counts it: no loan was
	 * touched. A void written after a snapshot counted the entry has no effect (never set then).
	 */
	voided?: true;
	/** Ids of the distribution logs this entry is applied to (empty when late, pending or voided). */
	loansApplied: string[];
	/**
	 * Refs NOT applied because the loan drifted since allocation (closed / outstanding too low /
	 * missing). The entry is kept and still counts in the pool.
	 */
	loansSkipped: BulkReturnLoanSkipped[];
	/** Part of the qty not allocated to any loan (goes into the pool without a loan ref). */
	unallocated_qty: string;
	/**
	 * Replay only: the entry is no longer in the pool it was created in (`entry.pool_id`). `moved` =
	 * it was moved to `relocated_pool_id` (nothing done here; the move applies its loans);
	 * `pending_sync` = its move chain has a gap so its pool is unknown yet. No loan was touched
	 * either way.
	 */
	relocated?: 'moved' | 'pending_sync';
	/** The entry's current pool when `relocated` is 'moved'. */
	relocated_pool_id?: string;
	/**
	 * The entry's loans were deliberately reopened by a manager (CR-193 §35), so they must not stay
	 * cut. The reopen can be seen before the cut (replay pre-check: nothing is cut) or right after
	 * the cut (the applied refs are then reverted); either way no loan is left cut.
	 */
	loans_reopened?: true;
}

export interface AddBulkReturnEntriesResult {
	/**
	 * One result per item that was written or replayed, in the order of `input.items`. An item that
	 * is not listed was not written (blocked pool, or processing stopped); it stays in the form for a
	 * retry. Match results to items by `entry._id` = `bulk_return_entry:<operationUlid>`.
	 */
	results: AddBulkReturnEntryResult[];
	/**
	 * Set when `input.pool_id` could not take the new items (closed or locked) while other items were
	 * replays: the replays were processed, the new items were not written.
	 */
	blocked?: { pool_id: string; reason: 'closed' | 'locked' };
	/** False for an unspecified returner. */
	returner_had_outstanding_loans: boolean;
	/** Specified returner with no outstanding loan for any added item: UI warns, the write is allowed. */
	no_outstanding_loan: boolean;
}

function returnerIdOf(returner: BulkReturnReturnerInput): string | null {
	return returner.type === 'unspecified' ? null : returner.id;
}

function assertReturnerShape(returner: BulkReturnReturnerInput): void {
	if (returner.type === 'unspecified') return;
	if (returner.type !== 'evacuee' && returner.type !== 'volunteer') {
		throw new WorkflowValidationError('returner type must be evacuee, volunteer or unspecified');
	}
	if (!returner.id.startsWith(`${returner.type}:`)) {
		throw new WorkflowValidationError(`returner id must start with ${returner.type}:`);
	}
}

function sumRefs(refs: readonly BulkReturnEntryLoanRef[]): string {
	return refs.reduce((acc, ref) => addQty(acc, ref.qty), '0');
}

function assertSameEntry(
	actual: BulkReturnEntry,
	expected: {
		item_id: string;
		qty: string;
		returner_type: BulkReturnEntryReturnerType;
		returner_id: string | null;
	}
): void {
	// The pool is not compared: a replay stays bound to the pool the entry was created in.
	if (
		actual.item_id !== expected.item_id ||
		!parseQty(actual.qty).eq(expected.qty) ||
		actual.returner_type !== expected.returner_type ||
		actual.returner_id !== expected.returner_id
	) {
		throw new ConcurrencyCollisionError(
			`bulk_return_entry ${actual._id} already exists with different content`
		);
	}
}

/** Marks `refs` as claimed on the local loan copies so a later item does not allocate them again. */
function claimOnLocalLoans(
	loans: LoanLike[],
	entry: BulkReturnEntry,
	refs: readonly BulkReturnEntryLoanRef[]
): void {
	for (const ref of refs) {
		const idx = loans.findIndex((loan) => loan._id === ref.distribution_log_id);
		if (idx < 0) continue;
		const loan = loans[idx];
		if ((loan.applied_bulk_entry_ids ?? []).includes(entry._id)) continue; // already counted
		loans[idx] = { ...loan, qty_returned: addQty(loan.qty_returned ?? '0', ref.qty) };
	}
}

/**
 * Records one or more drop-offs (several item kinds, any number of calls) into an OPEN pool and
 * closes / reduces the returner's loans.
 *
 * Order: validate everything (items eligible, pool appendable) before writing; then per item write
 * the entry (put-if-absent, replay-safe), FENCE (re-read the pool), and only then apply the loans.
 * The fence (`settlePoolFence`) waits out a submit / cancel lock and decides from the final pool
 * state: OPEN → apply the loans; closed with the entry in the submit snapshot → apply the loans
 * (not late) and STOP; closed without it → report `late` with no loan touched (applied later, when
 * it is moved into an OPEN pool) and STOP. A lock that never clears does not throw once the entry
 * is written: the item is reported with `loan_pending` (no loan touched) and processing STOPS. After
 * a stop later new items are not written, so `results` holds only the items written or replayed so
 * far, in the order of `input.items`. Retrying with the same operationUlids is idempotent.
 *
 * A replayed item (its entry already exists) is bound to the pool the entry was created in, never
 * to `input.pool_id`: it fences that pool and cuts its outstanding loans there (idempotent via
 * `applied_bulk_entry_ids`). Replays are processed BEFORE new items so their claims count on the
 * local loans before allocation. A replay's stop applies only to new writes into `input.pool_id`
 * (when the replay's pool is that pool); it never stops other replays or writes elsewhere. When
 * `input.pool_id` cannot take new items: with no replay it throws `BulkReturnPoolStateError`; with
 * replays they are processed and the result carries `blocked` with the new items unwritten.
 *
 * A replayed entry that was moved out of its pool meanwhile (or whose move chain is pending sync)
 * is reported with `relocated`: no fence, no loan touched (the move path owns its loans) and the
 * remaining items are still processed normally.
 *
 * A reopen of the entry's loans (CR-193 §35) wins over the replay's fence / loan cut
 * (`loans_reopened`).
 *
 * A void only counts while the entry is NOT in a submit snapshot (CR-193 §33): a replay of an entry
 * that is voided and not counted returns `voided` at once (no fence, no loan cut); otherwise right
 * before each loan is cut the void is re-read inside the loan CAS (fence 'open' only) and a voided
 * entry cuts nothing (`voided`). An entry counted in a snapshot ignores a void and has its loans cut.
 */
export async function addBulkReturnEntries(
	input: AddBulkReturnEntriesInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<AddBulkReturnEntriesResult> {
	const {
		poolRepo,
		eventRepo,
		logRepo,
		catalogRepo,
		endpointStore: epStore,
		fenceClock
	} = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	// --- validate input (no I/O) ---
	if (input.items.length === 0) {
		throw new WorkflowValidationError('At least one item is required');
	}
	assertReturnerShape(input.returner);
	const seenOps = new Set<string>();
	for (const item of input.items) {
		if (!item.item_id) throw new WorkflowValidationError('item_id is required');
		assertPositiveIntegerQty(item.qty, 'qty', `for ${item.item_id}`);
		assertOperationUlid(item.operationUlid);
		if (seenOps.has(item.operationUlid)) {
			throw new WorkflowValidationError(`Duplicate operationUlid ${item.operationUlid}`);
		}
		seenOps.add(item.operationUlid);
	}

	// --- validate against catalog (before any write) ---
	const masters = await catalogRepo.listItemMasters(ctx.shelterCode);
	const mastersById = new Map(masters.map((m) => [m._id, m]));
	for (const item of input.items) {
		const master = mastersById.get(item.item_id);
		if (!master) {
			throw new WorkflowValidationError(`Item master ${item.item_id} was not found`);
		}
		if (!isBulkReturnEligibleItem(master as { returnable?: boolean })) {
			throw new WorkflowValidationError(
				`Item ${item.item_id} is not returnable and cannot be added to a bulk return pool`
			);
		}
	}

	// --- validate pool (before any write); a full replay of already-written entries is allowed ---
	const entryIds = input.items.map((item) => `bulk_return_entry:${item.operationUlid}`);
	const existingEntries = await Promise.all(entryIds.map((id) => eventRepo.getEntry(id)));
	const pool = await requirePool(poolRepo, input.pool_id);
	const hasReplay = existingEntries.some((entry) => entry !== null);
	let blocked: AddBulkReturnEntriesResult['blocked'];
	if (!canAppendToPool(pool) && existingEntries.some((entry) => entry === null)) {
		const reason = pool.status === 'OPEN' ? 'locked' : 'closed';
		if (!hasReplay) {
			throw new BulkReturnPoolStateError(
				`Bulk return pool ${pool._id} is not accepting entries (status ${pool.status}${pool.lock ? `, locked for ${pool.lock.op}` : ''})`,
				reason
			);
		}
		blocked = { pool_id: pool._id, reason };
	}

	// --- load the returner's loans once ---
	const returnerId = returnerIdOf(input.returner);
	let loans: LoanLike[] = [];
	if (returnerId) {
		// Fail closed: a skipped malformed loan of this returner could be one the allocation must claim.
		const found = await logRepo.listWithSkipped({ recipient_id: returnerId, is_returnable: true });
		assertNoSkippedDocs(found.skipped, 'loan allocation');
		loans = found.items;
	}
	const returner_had_outstanding_loans =
		returnerId !== null && outstandingLoansOf(loans, returnerId).length > 0;
	const no_outstanding_loan =
		returnerId !== null &&
		!input.items.some(
			(item) => selectOutstandingLoans(loans, { returnerId, itemId: item.item_id }).length > 0
		);

	const returner_type: BulkReturnEntryReturnerType = input.returner.type;
	const slots: (AddBulkReturnEntryResult | undefined)[] = input.items.map(() => undefined);
	const timedOutPools = new Set<string>();

	/**
	 * Fences the entry's own pool and cuts its loans. `stop` = the pool stopped taking entries
	 * (late / counted by a submit / lock timeout): no further new item may be written into it.
	 */
	async function settleLine(
		entry: BulkReturnEntry,
		replayed: boolean
	): Promise<{ result: AddBulkReturnEntryResult; stop: boolean }> {
		const unallocated_qty = subQty(entry.qty, sumRefs(entry.loan_refs));

		// A replayed entry may have been moved since it was created (e.g. the first call timed out on
		// the fence, staff moved it): its creation pool is then no longer where it counts, so fencing
		// that pool / cutting loans here could cut a loan no snapshot counts. The move path owns that.
		if (replayed) {
			const events = await eventRepo.listForEntry(entry._id);
			assertNoSkippedDocs(events.skipped, `bulk return entry ${entry._id}`);
			const fold = foldEntryMoves(
				entry,
				events.moves.filter((m) => m.entry_id === entry._id)
			);
			const pins = await loadSnapshotPinsForWrite(poolRepo, events);
			const current =
				fold.status === 'resolved'
					? resolveBulkReturnEntries(events.entries, events.moves, events.voids, pins).find(
							(r) => r.entry._id === entry._id
						)
					: undefined;
			if (fold.status === 'pending' || !current) {
				return {
					result: {
						entry,
						late: false,
						replayed,
						loansApplied: [],
						loansSkipped: [],
						unallocated_qty,
						relocated: 'pending_sync'
					},
					stop: false
				};
			}
			if (current.pool_id !== entry.pool_id) {
				return {
					result: {
						entry,
						late: false,
						replayed,
						loansApplied: [],
						loansSkipped: [],
						unallocated_qty,
						relocated: 'moved',
						relocated_pool_id: current.pool_id
					},
					stop: false
				};
			}
			// Loans reopened by a manager after the pool closed (CR-193 §35): never cut them again.
			// A move cannot reach here: a pinned entry (counted in a closed pool's snapshot) cannot
			// leave that pool, so a reopened entry always still resolves to its creation pool. Reopen
			// wins over the replay's fence / loan cut on that pool. `stop` is false on purpose: a reopen
			// only applies to an entry counted in a closed pool's snapshot, and a closed pool already
			// blocks new lines into it (`blocked`), so there is nothing left to stop.
			if ((await eventRepo.getLoanReopen(deriveLoanReopenId(entry._id))) !== null) {
				return {
					result: {
						entry,
						late: false,
						replayed,
						loansApplied: [],
						loansSkipped: [],
						unallocated_qty,
						loans_reopened: true
					},
					stop: false
				};
			}
			// Voided and NOT counted in a submit snapshot (a pinned entry resolves `voided: false`, so
			// `current.voided` means no snapshot counts it; CR-193 §33): the void is effective. Return
			// right away, with no fence wait (a lock that outlives the timeout must not turn this into
			// `loan_pending`) and no loan cut. A voided entry never ends the pool's accepting state.
			// A pinned entry with a late void doc skips this and takes the normal fence + cut path.
			if (current.voided) {
				return {
					result: {
						entry,
						late: false,
						replayed,
						voided: true,
						loansApplied: [],
						loansSkipped: [],
						unallocated_qty
					},
					stop: false
				};
			}
		}

		// FENCE: the pool may have been locked / submitted / cancelled after the entry landed. A lock
		// is waited out: the submit may already have counted this entry in its snapshot.
		// A pool whose lock already outlived the fence timeout in this call stays pending: later lines
		// into it do not wait another full timeout.
		const pendingResult = {
			result: {
				entry,
				late: false,
				replayed,
				loan_pending: true as const,
				loansApplied: [],
				loansSkipped: [],
				unallocated_qty
			},
			stop: true
		};
		if (timedOutPools.has(entry.pool_id)) return pendingResult;
		let fence: Awaited<ReturnType<typeof settlePoolFence>>;
		try {
			fence = await settlePoolFence(poolRepo, entry.pool_id, entry._id, fenceClock);
		} catch (err) {
			if (!(err instanceof BulkReturnPoolLockTimeoutError)) throw err;
			timedOutPools.add(entry.pool_id);
			// The entry is written and counts in its pool; only the loans are pending.
			return pendingResult;
		}
		if (fence === 'late') {
			return {
				result: {
					entry,
					late: true,
					replayed,
					loansApplied: [],
					loansSkipped: [],
					unallocated_qty
				},
				stop: true
			};
		}

		const voidId = deriveEntryVoidId(entry._id);
		const isEntryVoided = async () => (await eventRepo.getVoid(voidId)) !== null;
		// CR-193 §33 / FR-33.1: a void written after the submit snapshot counted the entry has no
		// effect, so the void re-check applies only while the entry is not counted (fence 'open').
		const voidCheck = fence === 'in_snapshot' ? undefined : isEntryVoided;
		const loansApplied: string[] = [];
		const loansSkipped: BulkReturnLoanSkipped[] = [];
		let voided = false;
		for (const ref of entry.loan_refs) {
			// Loan drift rule: the ref is applied only if the loan, read fresh inside the CAS, can still
			// take the WHOLE ref.qty. A missing / closed loan or outstanding < ref.qty is skipped (no
			// write, no throw): the entry stays and the item still counts in the pool; the UI derives a
			// warning at read time. Never a partial apply: void reverts ref.qty and no per-entry applied
			// qty is persisted, so a partial apply would over-revert on a later void.
			// A voided entry not counted in a snapshot never cuts a loan: the void is re-read inside
			// every CAS attempt. An in_snapshot entry ignores a void (it stays counted and cut).
			const outcome = await applyRefToLoanDetailed(logRepo, entry, ref, ctx, voidCheck);
			if (outcome.voided) voided = true;
			else if (outcome.skipped) loansSkipped.push(outcome.skipped);
			else loansApplied.push(ref.distribution_log_id);
		}
		// Counted by a submit that closed the pool: the next items would only land late, so stop.
		const stop = fence === 'in_snapshot';
		// A manager may reopen the entry's loans between the pre-check (replay only) and the CAS
		// writes above, on a fresh entry too (a submit can count it first): re-check after the writes
		// and undo them, so a reopened loan is never left cut. Reopen wins over everything else.
		if (loansApplied.length > 0) {
			const appliedRefs = entry.loan_refs.filter((ref) =>
				loansApplied.includes(ref.distribution_log_id)
			);
			if (await revertAppliedRefsIfReopened(eventRepo, logRepo, entry, appliedRefs, ctx)) {
				return {
					result: {
						entry,
						late: false,
						replayed,
						loansApplied: [],
						loansSkipped: [],
						unallocated_qty,
						loans_reopened: true
					},
					stop
				};
			}
		}
		return {
			result: {
				entry,
				late: false,
				replayed,
				...(voided ? { voided: true as const } : {}),
				loansApplied,
				loansSkipped,
				unallocated_qty
			},
			stop
		};
	}

	const expectedOf = (item: AddBulkReturnEntriesInput['items'][number]) => ({
		item_id: item.item_id,
		qty: item.qty,
		returner_type,
		returner_id: returnerId
	});

	// Replays first: claim their refs on the local loans so new items do not allocate them again.
	const replays: { i: number; entry: BulkReturnEntry }[] = [];
	const newIdx: number[] = [];
	for (let i = 0; i < input.items.length; i++) {
		const entry = existingEntries[i];
		if (entry) {
			assertSameEntry(entry, expectedOf(input.items[i]));
			claimOnLocalLoans(loans, entry, entry.loan_refs);
			replays.push({ i, entry });
		} else {
			newIdx.push(i);
		}
	}

	// Once the input pool stops taking entries (blocked, late, counted by a submit, lock timeout) no
	// new item is written into it; replays on other pools are unaffected.
	let inputPoolStopped = blocked !== undefined;

	for (const { i, entry } of replays) {
		const { result, stop } = await settleLine(entry, true);
		slots[i] = result;
		if (stop && entry.pool_id === input.pool_id) inputPoolStopped = true;
	}

	for (const i of newIdx) {
		if (inputPoolStopped) break;
		const item = input.items[i];
		// CR-193 §17: oldest-first allocation, implemented only in the domain helper
		// allocateBulkReturnToLoans (single place to change).
		const refs = returnerId
			? allocateBulkReturnToLoans(
					selectOutstandingLoans(loans, { returnerId, itemId: item.item_id }),
					item.qty
				)
			: [];
		const doc = createBulkReturnEntry(
			{
				pool_id: input.pool_id,
				item_id: item.item_id,
				qty: item.qty,
				returner_type,
				returner_id: returnerId,
				loan_refs: refs,
				...(input.notes ? { notes: input.notes } : {})
			},
			ctx,
			item.operationUlid
		);
		let entry: BulkReturnEntry;
		let replayed = false;
		try {
			entry = await eventRepo.createEntry(doc);
		} catch (err) {
			if (!(err instanceof ConflictError)) throw err;
			const winner = await eventRepo.getEntry(doc._id);
			if (!winner) throw err;
			assertSameEntry(winner, expectedOf(item));
			entry = winner;
			replayed = true;
		}
		claimOnLocalLoans(loans, entry, entry.loan_refs);
		const { result, stop } = await settleLine(entry, replayed);
		slots[i] = result;
		if (stop && entry.pool_id === input.pool_id) break;
	}

	const results = slots.filter((slot): slot is AddBulkReturnEntryResult => slot !== undefined);
	return {
		results,
		...(blocked ? { blocked } : {}),
		returner_had_outstanding_loans,
		no_outstanding_loan
	};
}

/**
 * Which operationUlids already wrote a bulk return entry (`bulk_return_entry:<operationUlid>`),
 * with the written qty and item. Unwritten ulids are absent from the map. Read-only.
 */
export async function findWrittenBulkReturnEntries(
	operationUlids: readonly string[],
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<Map<string, { qty: string; item_id: string }>> {
	for (const ulid of operationUlids) assertOperationUlid(ulid);
	const { eventRepo } = resolveDependencies(deps, ctx);
	const found = await Promise.all(
		operationUlids.map((ulid) => eventRepo.getEntry(`bulk_return_entry:${ulid}`))
	);
	const written = new Map<string, { qty: string; item_id: string }>();
	operationUlids.forEach((ulid, i) => {
		const entry = found[i];
		if (entry) written.set(ulid, { qty: entry.qty, item_id: entry.item_id });
	});
	return written;
}
