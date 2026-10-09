/**
 * Background status sync for tickets stored on the citizen's device.
 *
 * Safety rule: a ticket is the citizen's only QR for the central queue, so the sync may
 * remove it ONLY when the server positively confirms it was claimed (`verified`).
 * `notFound` is reported back for the UI but never removed automatically (the user can
 * delete it with the existing remove button), and transport / upstream errors are ignored.
 */
import { checkTicketStatus } from '../data/public-register.api';
import { getStoredTickets, removeStoredTicket } from '../data/ticket-storage';

export interface TicketSyncResult {
	/** Codes confirmed as claimed — already removed from local storage. */
	verified: string[];
	/** Codes the server says no longer exist — kept in local storage. */
	notFound: string[];
}

export async function syncStoredTicketStatuses(): Promise<TicketSyncResult> {
	const result: TicketSyncResult = { verified: [], notFound: [] };

	for (const ticket of getStoredTickets()) {
		try {
			const res = await checkTicketStatus(ticket.code);
			if (res.verified) {
				removeStoredTicket(ticket.code);
				result.verified.push(ticket.code);
			} else if (res.notFound) {
				result.notFound.push(ticket.code);
			}
		} catch {
			// Network / unexpected error — keep the ticket and try again next time.
		}
	}

	return result;
}
