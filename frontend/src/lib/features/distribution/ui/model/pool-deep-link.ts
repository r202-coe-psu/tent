/**
 * Deep-linked bulk return pool (`?pool=<id>`) resolution for the shared pool board. Pure — no
 * Svelte, no I/O.
 */

export interface MissingDeepLinkedPoolInput {
	/** Pool id the board is asked to open (URL deep link or local selection); null when none. */
	poolId: string | null | undefined;
	/** The UNFILTERED overview rows (already include CANCELLED and old RECEIVED pools). */
	rows: readonly { pool: { _id: string } }[];
	/** True only when the overview query succeeded and is not refetching (no stale / placeholder data). */
	dataReady: boolean;
	/** Last id chosen through the board's own selection (card, queue, just-opened pool dialog). */
	locallySelectedId?: string | null;
}

/**
 * The id of a deep-linked pool that does not exist in the loaded overview, else null.
 *
 * Only "not in the data" counts as not found: pools hidden by the board's view filters (old
 * RECEIVED, CANCELLED with the toggle off, search / status filters) are in `rows` and must still
 * open. An id the user selected locally is skipped: a pool that was just opened is selected before
 * the overview refetch contains it.
 */
export function missingDeepLinkedPoolId(input: MissingDeepLinkedPoolInput): string | null {
	const { poolId, rows, dataReady, locallySelectedId } = input;
	if (!poolId || !dataReady) return null;
	if (poolId === locallySelectedId) return null;
	return rows.some((row) => row.pool._id === poolId) ? null : poolId;
}
