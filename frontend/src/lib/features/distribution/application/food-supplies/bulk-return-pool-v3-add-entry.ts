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
	foldEntryMoves,
	isBulkReturnEligibleItem,
	resolveBulkReturnEntries,
	selectOutstandingLoans
} from '../../domain/food-supplies';
import { assertCanWriteBulkReturnEntry } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import {
	assertNoSkippedDocs,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	WorkflowValidationError
} from './errors';
import { assertPositiveIntegerQty } from './validation';
import {
	applyRefToLoan,
	assertOperationUlid,
	loadSnapshotPinsForWrite,
	outstandingLoansOf,
	requirePool,
	resolveDependencies,
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
	/** Ids of the distribution logs this entry is applied to (empty when late or voided). */
	loansApplied: string[];
	/**
	 * Refs NOT applied because the loan drifted since allocation (closed / outstanding too low /
	 * missing). The entry is kept and still counts in the pool.
	 */
	loansSkipped: BulkReturnLoanSkipped[];
	/** Part of the qty not allocated to any loan (goes into the pool without a loan ref). */
	unallocated_qty: string;
	/**
	 * Replay only: the entry is no longer in `input.pool_id`. `moved` = it was moved to
	 * `relocated_pool_id` (nothing done here; the move applies its loans); `pending_sync` = its move
	 * chain has a gap so its pool is unknown yet. No loan was touched either way.
	 */
	relocated?: 'moved' | 'pending_sync';
	/** The entry's current pool when `relocated` is 'moved'. */
	relocated_pool_id?: string;
}

export interface AddBulkReturnEntriesResult {
	/** One result per item that was written; see the fence note on `addBulkReturnEntries`. */
	results: AddBulkReturnEntryResult[];
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
		pool_id: string;
		item_id: string;
		qty: string;
		returner_type: BulkReturnEntryReturnerType;
		returner_id: string | null;
	}
): void {
	if (
		actual.pool_id !== expected.pool_id ||
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
 * it is moved into an OPEN pool) and STOP. After a stop later items are not written, so `results`
 * holds only the items written so far. A lock that never clears throws
 * `BulkReturnPoolLockTimeoutError`. Retrying with the same operationUlids is idempotent.
 *
 * A replayed entry that was moved out of `input.pool_id` meanwhile (or whose move chain is pending
 * sync) is reported with `relocated`: no fence, no loan touched (the move path owns its loans) and
 * the remaining items are still processed normally.
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
	if (!canAppendToPool(pool) && existingEntries.some((entry) => entry === null)) {
		throw new BulkReturnPoolStateError(
			`Bulk return pool ${pool._id} is not accepting entries (status ${pool.status}${pool.lock ? `, locked for ${pool.lock.op}` : ''})`,
			pool.status === 'OPEN' ? 'locked' : 'closed'
		);
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
	const results: AddBulkReturnEntryResult[] = [];

	for (let i = 0; i < input.items.length; i++) {
		const item = input.items[i];
		const expected = {
			pool_id: input.pool_id,
			item_id: item.item_id,
			qty: item.qty,
			returner_type,
			returner_id: returnerId
		};

		let entry = existingEntries[i];
		let replayed = entry !== null;
		if (entry) {
			assertSameEntry(entry, expected);
			claimOnLocalLoans(loans, entry, entry.loan_refs);
		} else {
			// DEFAULT policy, not confirmed by the user: oldest-first allocation, implemented only in the
			// domain helper allocateBulkReturnToLoans (single place to change).
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
			try {
				entry = await eventRepo.createEntry(doc);
			} catch (err) {
				if (!(err instanceof ConflictError)) throw err;
				const winner = await eventRepo.getEntry(doc._id);
				if (!winner) throw err;
				assertSameEntry(winner, expected);
				entry = winner;
				replayed = true;
			}
			claimOnLocalLoans(loans, entry, entry.loan_refs);
		}

		const unallocated_qty = subQty(entry.qty, sumRefs(entry.loan_refs));

		// A replayed entry may have been moved since it was created (e.g. the first call timed out on
		// the fence, staff moved it): its input pool is then no longer where it counts, so fencing that
		// pool / cutting loans here could cut a loan no snapshot counts. The move path owns that.
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
				results.push({
					entry,
					late: false,
					replayed,
					loansApplied: [],
					loansSkipped: [],
					unallocated_qty,
					relocated: 'pending_sync'
				});
				continue;
			}
			if (current.pool_id !== input.pool_id) {
				results.push({
					entry,
					late: false,
					replayed,
					loansApplied: [],
					loansSkipped: [],
					unallocated_qty,
					relocated: 'moved',
					relocated_pool_id: current.pool_id
				});
				continue;
			}
		}

		// FENCE: the pool may have been locked / submitted / cancelled after the entry landed. A lock
		// is waited out: the submit may already have counted this entry in its snapshot.
		const fence = await settlePoolFence(poolRepo, input.pool_id, entry._id, fenceClock);
		if (fence === 'late') {
			results.push({
				entry,
				late: true,
				replayed,
				loansApplied: [],
				loansSkipped: [],
				unallocated_qty
			});
			break;
		}

		// A replayed entry may have been voided meanwhile: never re-apply its loans.
		const voided = replayed && (await eventRepo.getVoid(deriveEntryVoidId(entry._id))) !== null;
		const loansApplied: string[] = [];
		const loansSkipped: BulkReturnLoanSkipped[] = [];
		if (!voided) {
			for (const ref of entry.loan_refs) {
				// Loan drift rule: the ref is applied only if the loan, read fresh inside the CAS, can still
				// take the WHOLE ref.qty. A missing / closed loan or outstanding < ref.qty is skipped (no
				// write, no throw): the entry stays and the item still counts in the pool; the UI derives a
				// warning at read time. Never a partial apply: void reverts ref.qty and no per-entry applied
				// qty is persisted, so a partial apply would over-revert on a later void.
				const skipped = await applyRefToLoan(logRepo, entry, ref, ctx);
				if (skipped) loansSkipped.push(skipped);
				else loansApplied.push(ref.distribution_log_id);
			}
		}
		results.push({ entry, late: false, replayed, loansApplied, loansSkipped, unallocated_qty });
		// Counted by a submit that closed the pool: the next items would only land late, so stop.
		if (fence === 'in_snapshot') break;
	}

	return { results, returner_had_outstanding_loans, no_outstanding_loan };
}
