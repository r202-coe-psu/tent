import { SHELTER_CLOSED_REASON } from '$lib/features/people/domain/people';

/** Where a check-out came from, as the kiosk tells a returning visitor (no staff names). */
export type KioskCheckoutChannel = 'kiosk' | 'staff' | 'shelter_closed';

/** A kiosk writes its movements as `scanner:<device id>` (see `kiosk-check-out.server.ts`). */
const KIOSK_AUTHOR_PREFIX = 'scanner:';

/** The channel of a `check_out` movement; anything that is not the kiosk or a closing is staff. */
export function checkoutChannelOf(movement: {
	created_by?: string;
	reason?: string;
}): KioskCheckoutChannel {
	if (movement.reason === SHELTER_CLOSED_REASON) return 'shelter_closed';
	if (movement.created_by?.startsWith(KIOSK_AUTHOR_PREFIX)) return 'kiosk';
	return 'staff';
}
