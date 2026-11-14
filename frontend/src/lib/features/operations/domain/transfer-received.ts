import { qtyIsZero, subQty } from '$lib/utils/qty';

/**
 * Whether the quantity a receiver counted equals what was sent (#938). Compared as decimals, so
 * '0.3' and '0.30' match; a shortfall or surplus does not.
 */
export function receivedMatchesSent(sent: string, received: string): boolean {
	return qtyIsZero(subQty(received, sent));
}
