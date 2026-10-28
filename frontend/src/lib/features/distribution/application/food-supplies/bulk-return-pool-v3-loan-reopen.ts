import type { AuthorContext } from '$lib/db/model';
import { ConflictError } from '$lib/utils/errors';
import type {
	BulkReturnEntryLoanRef,
	BulkReturnLoanReopen,
	DistributionLog
} from '../../domain/food-supplies';
import {
	canReopenEntryLoans,
	createBulkReturnLoanReopen,
	deriveLoanReopenId,
	isBulkReturnRefRevertable,
	resolveBulkReturnEntries
} from '../../domain/food-supplies';
import { assertCanReopenBulkReturnLoan } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import { assertNoSkippedDocs, BulkReturnLoanReopenError, BulkReturnPoolStateError } from './errors';
import {
	loadSnapshotPinsForWrite,
	requirePool,
	resolveDependencies,
	revertRefOnLoan,
	type BulkReturnPoolV3WorkflowDependencies
} from './bulk-return-pool-v3-shared';

// ---------------------------------------------------------------------------------------------
// Loan reopen (CR-193 §35): take back the loan cut of ONE entry of a closed pool
// ---------------------------------------------------------------------------------------------

export interface ReopenBulkReturnEntryLoansInput {
	entry_id: string;
	/** Why the loans are reopened (required, 1-500 chars after trimming). */
	reason: string;
}

export interface ReopenBulkReturnEntryLoansResult {
	reopen: BulkReturnLoanReopen;
	replayed: boolean;
	/** Ids of loans actually reverted by this call (already reverted ones are not listed). */
	loansReopened: string[];
	/** Loans listed in the reopen doc that cannot be reverted any more (replay only). */
	loansSkipped: { distribution_log_id: string; reason: 'not_revertable' }[];
}

/**
 * Reopens the loans a bulk return entry of a SUBMITTED / RECEIVED pool closed (staff took the
 * returner's drop-off back after the pool was submitted). Writes one append-only
 * `bulk_return_loan_reopen` doc and reverts the entry's loan refs; it never touches the pool
 * snapshot, the entry or stock. Idempotent: a replay re-runs the (idempotent) reverts.
 */
export async function reopenBulkReturnEntryLoans(
	input: ReopenBulkReturnEntryLoansInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<ReopenBulkReturnEntryLoansResult> {
	const { poolRepo, eventRepo, logRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanReopenBulkReturnLoan(ctx);

	const reason = input.reason.trim();
	if (!reason) {
		throw new BulkReturnLoanReopenError('A reason is required to reopen a loan', 'reason_required');
	}

	const events = await eventRepo.listForEntry(input.entry_id);
	// Fail closed: a skipped doc of this entry's chain would hide its move / void state.
	assertNoSkippedDocs(events.skipped, `bulk return entry ${input.entry_id}`);
	const entry = events.entries.find((e) => e._id === input.entry_id);
	if (!entry) {
		throw new BulkReturnLoanReopenError(
			`bulk_return_entry ${input.entry_id} not found`,
			'entry_not_found'
		);
	}

	const pins = await loadSnapshotPinsForWrite(poolRepo, events);
	const resolved = resolveBulkReturnEntries(events.entries, events.moves, events.voids, pins).find(
		(r) => r.entry._id === entry._id
	);
	const pool = await requirePool(poolRepo, resolved?.pool_id ?? entry.pool_id);
	if (!canReopenEntryLoans(pool, entry._id)) {
		if (pool.status === 'OPEN' || pool.status === 'CANCELLED') {
			throw new BulkReturnPoolStateError(
				pool.status === 'OPEN'
					? `Pool ${pool._id} is still OPEN: void the entry instead of reopening its loans`
					: `Pool ${pool._id} is CANCELLED: nothing to reopen`,
				pool.status === 'OPEN' ? 'not_submitted' : 'closed'
			);
		}
		throw new BulkReturnLoanReopenError(
			`Entry ${entry._id} is not in the ${pool._id} snapshot`,
			'not_in_snapshot'
		);
	}

	// Loans are read BEFORE the reopen doc: a loan already reverted by a concurrent call implies
	// that call's doc exists (it writes the doc first), so the replay check below cannot miss it.
	const refById = new Map(entry.loan_refs.map((ref) => [ref.distribution_log_id, ref]));
	const loans = await Promise.all([...refById.keys()].map((id) => logRepo.get(id)));
	const applied = loans.filter(
		(loan): loan is DistributionLog =>
			loan !== null && (loan.applied_bulk_entry_ids ?? []).includes(entry._id)
	);

	let reopen = await eventRepo.getLoanReopen(deriveLoanReopenId(entry._id));
	let replayed = reopen !== null;

	if (!reopen) {
		if (applied.length === 0) {
			throw new BulkReturnLoanReopenError(
				`Entry ${entry._id} has no applied loan to reopen (nothing was cut or it was already reverted)`,
				'no_applied_loan'
			);
		}
		// Pre-check BEFORE writing: a later revert of an unrevertable loan would throw and wedge
		// the operation with the doc already written.
		for (const loan of applied) {
			const ref = refById.get(loan._id) as BulkReturnEntryLoanRef;
			if (!isBulkReturnRefRevertable(loan, ref)) {
				throw new BulkReturnLoanReopenError(
					`Loan ${loan._id} cannot be reopened (status: ${loan.status}); resolve it first`,
					'loan_not_revertable',
					loan.status
				);
			}
		}
		const doc = createBulkReturnLoanReopen(
			{ entry, pool_id: pool._id, reason, loan_ids: applied.map((loan) => loan._id) },
			ctx
		);
		try {
			reopen = await eventRepo.createLoanReopen(doc);
		} catch (err) {
			if (!(err instanceof ConflictError)) throw err;
			// A concurrent call won: keep its stored doc and finish the (idempotent) reverts.
			const winner = await eventRepo.getLoanReopen(doc._id);
			if (!winner) throw err;
			reopen = winner;
			replayed = true;
		}
	}

	const loansReopened: string[] = [];
	const loansSkipped: ReopenBulkReturnEntryLoansResult['loansSkipped'] = [];
	for (const loanId of reopen.loan_ids) {
		const ref = refById.get(loanId);
		if (!ref) continue;
		if (replayed) {
			// Never throw on a replay: a loan that moved on (lost / waived / ...) is reported.
			const current = await logRepo.get(loanId);
			if (
				current &&
				(current.applied_bulk_entry_ids ?? []).includes(entry._id) &&
				!isBulkReturnRefRevertable(current, ref)
			) {
				loansSkipped.push({ distribution_log_id: loanId, reason: 'not_revertable' });
				continue;
			}
		}
		if (await revertRefOnLoan(logRepo, entry, ref, ctx)) loansReopened.push(loanId);
	}
	return { reopen, replayed, loansReopened, loansSkipped };
}
