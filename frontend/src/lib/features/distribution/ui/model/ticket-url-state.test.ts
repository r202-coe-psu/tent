import { describe, expect, it } from 'vitest';
import {
	TICKET_URL_DEFAULTS,
	mergeTicketParams,
	parseTicketParams,
	serializeTicketParams
} from './ticket-url-state';

describe('ticket url state', () => {
	it('empty params parse to defaults', () => {
		expect(parseTicketParams(new URLSearchParams())).toEqual(TICKET_URL_DEFAULTS);
	});

	it('bad values fall back to defaults', () => {
		const state = parseTicketParams(
			new URLSearchParams(
				'type=kitchen&group=nope&status=FOO&from=2026-02-30&to=abc&follow=yes&sort=up'
			)
		);
		expect(state).toEqual(TICKET_URL_DEFAULTS);
	});

	it('parses valid values and drops statuses outside the group', () => {
		const state = parseTicketParams(
			new URLSearchParams(
				'q=abc&type=food&dest=A&group=pending_ready&status=PENDING_PICK,IN_TRANSIT,PENDING_PICK&from=2026-09-01&to=2026-09-30&follow=1&sort=asc'
			)
		);
		expect(state).toEqual({
			q: 'abc',
			type: 'food',
			dest: 'A',
			group: 'pending_ready',
			status: ['PENDING_PICK'],
			from: '2026-09-01',
			to: '2026-09-30',
			follow: true,
			sort: 'asc'
		});
	});

	it('serializes only non-default keys', () => {
		expect(serializeTicketParams(TICKET_URL_DEFAULTS).toString()).toBe('');
		expect(
			serializeTicketParams({
				...TICKET_URL_DEFAULTS,
				group: 'completed',
				status: ['COMPLETED', 'CANCELLED'],
				follow: true
			}).toString()
		).toBe('group=completed&status=COMPLETED%2CCANCELLED&follow=1');
	});

	it('round-trips', () => {
		const state = {
			...TICKET_URL_DEFAULTS,
			q: 'x',
			type: 'supplies' as const,
			from: '2026-09-01',
			sort: 'asc' as const
		};
		expect(parseTicketParams(serializeTicketParams(state))).toEqual(state);
	});

	it('merge replaces ticket keys and keeps foreign keys', () => {
		const merged = mergeTicketParams(new URLSearchParams('ticketId=abc&q=old&tab=x&type=food'), {
			...TICKET_URL_DEFAULTS,
			q: 'new'
		});
		expect(merged.get('ticketId')).toBe('abc');
		expect(merged.get('tab')).toBe('x');
		expect(merged.get('q')).toBe('new');
		expect(merged.has('type')).toBe(false);
	});
});
