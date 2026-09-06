import { describe, it, expect, beforeEach } from 'vitest';
import {
	getStoredTickets,
	getLatestStoredTicket,
	saveTicketToStorage,
	removeStoredTicket,
	clearStoredTickets
} from './ticket-storage';
import type { BookingTicket } from '../application/booking-store.svelte';

const MOCK_TICKET_1: BookingTicket = {
	code: '01JABCDEF1234567890',
	shelter_code: 'SH001',
	shelter_name: 'ศูนย์พักพิงโรงเรียนเทศบาล 1',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	status: 'pre_registered',
	booked_at: '2026-09-03T10:00:00Z'
};

const MOCK_TICKET_2: BookingTicket = {
	code: '01JXYZ9876543210',
	shelter_code: 'SH002',
	shelter_name: 'ศูนย์พักพิงสนามกีฬา',
	first_name: 'สมหญิง',
	last_name: 'รักสงบ',
	status: 'pre_registered',
	booked_at: '2026-09-03T11:00:00Z'
};

describe('ticket-storage', () => {
	let store: Record<string, string> = {};

	beforeEach(() => {
		store = {};
		globalThis.localStorage = {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => {
				store[k] = v;
			},
			removeItem: (k: string) => {
				delete store[k];
			},
			clear: () => {
				store = {};
			},
			key: () => null,
			length: 0
		} as Storage;
		clearStoredTickets();
	});

	it('starts empty', () => {
		expect(getStoredTickets()).toEqual([]);
		expect(getLatestStoredTicket()).toBeNull();
	});

	it('saves and retrieves tickets, newest first', () => {
		saveTicketToStorage(MOCK_TICKET_1);
		expect(getStoredTickets()).toHaveLength(1);
		expect(getLatestStoredTicket()?.code).toBe(MOCK_TICKET_1.code);

		saveTicketToStorage(MOCK_TICKET_2);
		const tickets = getStoredTickets();
		expect(tickets).toHaveLength(2);
		expect(tickets[0].code).toBe(MOCK_TICKET_2.code);
		expect(tickets[1].code).toBe(MOCK_TICKET_1.code);
		expect(getLatestStoredTicket()?.code).toBe(MOCK_TICKET_2.code);
	});

	it('deduplicates tickets with the same code', () => {
		saveTicketToStorage(MOCK_TICKET_1);
		saveTicketToStorage({ ...MOCK_TICKET_1, shelter_name: 'Updated Name' });
		const tickets = getStoredTickets();
		expect(tickets).toHaveLength(1);
		expect(tickets[0].shelter_name).toBe('Updated Name');
	});

	it('removes a ticket by code', () => {
		saveTicketToStorage(MOCK_TICKET_1);
		saveTicketToStorage(MOCK_TICKET_2);
		removeStoredTicket(MOCK_TICKET_1.code);
		const tickets = getStoredTickets();
		expect(tickets).toHaveLength(1);
		expect(tickets[0].code).toBe(MOCK_TICKET_2.code);
	});

	it('clears all tickets', () => {
		saveTicketToStorage(MOCK_TICKET_1);
		saveTicketToStorage(MOCK_TICKET_2);
		clearStoredTickets();
		expect(getStoredTickets()).toEqual([]);
	});
});
