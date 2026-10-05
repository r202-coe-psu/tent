import { ulid } from './ulid';

/**
 * Ordered ULID pool for a multi-document write. `rewind()` replays the same
 * IDs in the same order, so retrying an identical write mints identical `_id`s
 * and `_bulk_docs` answers the already-committed docs with 409 (treated as
 * success) instead of persisting a second copy (data-model.md §2 idempotency).
 */
export class UlidReservation {
	#ids: string[] = [];
	#cursor = 0;

	/** Next reserved ULID — minted on first use, replayed after `rewind()`. */
	next(): string {
		if (this.#cursor === this.#ids.length) this.#ids.push(ulid());
		return this.#ids[this.#cursor++];
	}

	/** Restart from the first reserved ULID (call at the start of each attempt). */
	rewind(): void {
		this.#cursor = 0;
	}
}
