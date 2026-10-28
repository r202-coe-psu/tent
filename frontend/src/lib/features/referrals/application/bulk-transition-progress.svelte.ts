import type { ReferralStatus } from '../domain/referral.schema';

export type BulkItemFailure = { id: string; error: string };

/** Reactive state of one bulk run (and its retries) for the progress readout and result panel. */
export class BulkTransitionProgress {
	phase = $state<'idle' | 'running' | 'done'>('idle');
	/** Ids in the original run; stays fixed across retries so "สำเร็จ n / N" keeps counting up. */
	total = $state(0);
	succeeded = $state(0);
	failed = $state.raw<BulkItemFailure[]>([]);
	to = $state<ReferralStatus | null>(null);
	reason = $state<string | undefined>(undefined);

	start(total: number, to: ReferralStatus, reason?: string) {
		this.phase = 'running';
		this.total = total;
		this.succeeded = 0;
		this.failed = [];
		this.to = to;
		this.reason = reason;
	}

	/** Re-run only the failed ids: keeps the success count, clears the failure list to refill it. */
	beginRetry() {
		this.phase = 'running';
		this.failed = [];
	}

	addChunk(succeeded: number, failed: BulkItemFailure[]) {
		this.succeeded += succeeded;
		this.failed = [...this.failed, ...failed];
	}

	finish() {
		this.phase = 'done';
	}

	reset() {
		this.phase = 'idle';
		this.total = 0;
		this.succeeded = 0;
		this.failed = [];
		this.to = null;
		this.reason = undefined;
	}

	/** Chunk-granular fraction 0..1 of ids processed (succeeded or failed) in this run. */
	get fraction(): number {
		return this.total === 0 ? 0 : Math.min(1, (this.succeeded + this.failed.length) / this.total);
	}
}
