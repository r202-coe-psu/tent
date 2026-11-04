import type { ReferralBulkTransitionResult } from '../data/referral.repository';
import type { ReferralStatus } from '../domain/referral.schema';

/** Server limit per `POST bulk-transition` request (CR-167, #562). */
export const BULK_TRANSITION_CHUNK_SIZE = 200;

/** Split `items` into consecutive chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

export type BulkTransitionSend = (
	ids: string[],
	to: ReferralStatus,
	reason?: string
) => Promise<ReferralBulkTransitionResult>;

/**
 * Send `ids` one chunk at a time and accumulate the outcome. Never throws: a chunk whose request
 * fails marks all of its ids failed (so they can be retried) and the run carries on. Successes are
 * never rolled back.
 */
export async function runBulkTransition(options: {
	ids: string[];
	to: ReferralStatus;
	reason?: string;
	send: BulkTransitionSend;
	chunkSize?: number;
	/** Called after each chunk with that chunk's own outcome. */
	onChunk?: (result: ReferralBulkTransitionResult) => void;
}): Promise<ReferralBulkTransitionResult> {
	const { ids, to, reason, send, chunkSize = BULK_TRANSITION_CHUNK_SIZE, onChunk } = options;
	const total: ReferralBulkTransitionResult = { succeeded: [], failed: [] };
	for (const part of chunk(ids, chunkSize)) {
		let result: ReferralBulkTransitionResult;
		try {
			result = await send(part, to, reason);
		} catch (e) {
			const error = e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ';
			result = { succeeded: [], failed: part.map((id) => ({ id, error })) };
		}
		total.succeeded.push(...result.succeeded);
		total.failed.push(...result.failed);
		onChunk?.(result);
	}
	return total;
}
