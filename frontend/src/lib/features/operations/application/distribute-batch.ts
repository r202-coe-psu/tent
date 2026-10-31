/**
 * Issue several items under one requisition ticket (#837, CR-143 FR-A8, FR-A9).
 *
 * Lines run one after another in the order given, each through `distributeAcrossLots`
 * (a single-lot line is a one-row allocation list), every row on the one `ref_id`. The
 * ledger is append-only, so rows that landed are never rolled back: the run stops at
 * the first line that fails and reports the later ones as not attempted.
 */

import type { AuthorContext } from '$lib/db/model';
import type { BatchLinePlan, DistributeLineOutcome } from '../domain/distribute-batch';
import { distributeAcrossLots, type LotDistributor } from './distribute-across-lots';

export interface DistributeBatchResult {
	/** Same `ref_id` on every row of every line. */
	ref_id: string;
	/** One entry per input line, in input order. */
	outcomes: DistributeLineOutcome[];
	/** `true` when every line landed in full. */
	complete: boolean;
}

/** Never throws for a failed row: the caller needs the partial outcome to report it (FR-A9). */
export async function distributeBatch(
	repo: LotDistributor,
	lines: readonly BatchLinePlan[],
	ref_id: string,
	note: string,
	ctx: AuthorContext
): Promise<DistributeBatchResult> {
	const outcomes: DistributeLineOutcome[] = [];
	let stopped = false;

	for (const line of lines) {
		if (stopped) {
			outcomes.push({ kind: 'not_attempted', key: line.key });
			continue;
		}
		const result = await distributeAcrossLots(
			repo,
			{ allocations: line.allocations, item_id: line.item_id, ref_id, note },
			ctx
		);
		if (result.complete) {
			outcomes.push({ kind: 'done', key: line.key, distributedQty: result.distributedQty });
			continue;
		}
		stopped = true;
		const message = result.failure?.message ?? 'บันทึกไม่สำเร็จ';
		if (result.distributed.length === 0) {
			outcomes.push({ kind: 'failed', key: line.key, message });
		} else {
			outcomes.push({
				kind: 'partial',
				key: line.key,
				distributedQty: result.distributedQty,
				remainingQty: result.remainingQty,
				// every row of a line is cut in the lot's own unit, which is the item's base unit
				unit: line.allocations[0].lot.unit,
				message
			});
		}
	}

	return { ref_id, outcomes, complete: outcomes.every((o) => o.kind === 'done') };
}
