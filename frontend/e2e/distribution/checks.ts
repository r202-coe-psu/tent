/**
 * Persisted-state assertions for the Distribution suite. Every browser step is
 * checked twice — on screen and in CouchDB — so a UI that "looks done" but did
 * not write (or wrote the wrong thing) fails.
 */

import { expect } from '@playwright/test';
import type { CouchDocument } from '../helpers/couch';
import {
	findShelterDocuments,
	getShelterDocument,
	type SeededItem,
	type SeededTicket
} from './distribution';

export async function expectTicketStatus(
	ticket: SeededTicket,
	status: string,
	checkpoint: string
): Promise<void> {
	await expect
		.poll(async () => (await getShelterDocument(ticket.ticketId))?.status, {
			message: `${checkpoint}: ${ticket.ticketNo} should be ${status}`
		})
		.toBe(status);
}

/** Distribution logs written against one ticket item. */
export function ticketLogs(ticket: SeededTicket, item: SeededItem): Promise<CouchDocument[]> {
	return findShelterDocuments(
		(doc) =>
			doc.type === 'distribution_log' &&
			doc.ticket_id === ticket.ticketId &&
			doc.item_id === item.itemId
	);
}

/** Wait for exactly `count` logs on the ticket item and return them. */
export async function expectTicketLogs(
	ticket: SeededTicket,
	item: SeededItem,
	count: number,
	checkpoint: string
): Promise<CouchDocument[]> {
	await expect
		.poll(async () => (await ticketLogs(ticket, item)).length, {
			message: `${checkpoint}: expected ${count} distribution_log(s) for ${ticket.ticketNo}`
		})
		.toBe(count);
	return ticketLogs(ticket, item);
}

/** `stock_ledger` rows with `reason` that reference `refId`. */
export function ledgerRows(reason: string, refId: string): Promise<CouchDocument[]> {
	return findShelterDocuments(
		(doc) => doc.type === 'stock_ledger' && doc.reason === reason && doc.ref_id === refId
	);
}

/** Desk tickets (food + supplies) of the run's shelter in `status` — what the tab badges count. */
export async function deskTicketCount(status: string, type?: 'food' | 'supplies'): Promise<number> {
	const tickets = await findShelterDocuments(
		(doc) =>
			doc.type === 'requisition_ticket' &&
			doc.status === status &&
			(type
				? doc.requisition_type === type
				: ['food', 'supplies'].includes(String(doc.requisition_type)))
	);
	return tickets.length;
}
