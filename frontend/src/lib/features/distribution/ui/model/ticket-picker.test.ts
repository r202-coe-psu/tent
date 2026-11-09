import { describe, expect, it } from 'vitest';
import { needsCloseOutAction } from './desk-mode';
import { closeOutGroup, resolveCloseOutGroup, searchTickets } from './ticket-picker';

describe('searchTickets', () => {
	const tickets = [
		{ id: 'a', text: 'มื้อเย็น วันนี้ จุดแจก อาคารยิมเนเซียม 1 เลขตั๋ว TKT-FOOD-1' },
		{ id: 'b', text: 'มื้อเช้า วันนี้ จุดแจก โรงอาหาร เลขตั๋ว TKT-FOOD-2' }
	];
	const ids = (q: string) => searchTickets(tickets, q, (t) => t.text).map((t) => t.id);

	it('returns every ticket for an empty query', () => {
		expect(ids('  ')).toEqual(['a', 'b']);
	});

	it('needs every word to match, in any order, ignoring case', () => {
		expect(ids('ยิม เย็น')).toEqual(['a']);
		expect(ids('tkt-food-2')).toEqual(['b']);
		expect(ids('เย็น โรงอาหาร')).toEqual([]);
	});
});

describe('closeOutGroup', () => {
	it('puts tickets the desk must act on under action', () => {
		expect(closeOutGroup('DISTRIBUTING')).toBe('action');
		expect(closeOutGroup('SHIFT_CLOSED')).toBe('action');
		expect(closeOutGroup('RETURN_COMPLETED')).toBe('waiting');
		expect(closeOutGroup('RETURN_PENDING_RECEIPT')).toBe('waiting');
		expect(closeOutGroup('COMPLETED')).toBe('done');
	});

	it('uses the same rule as the close-out tab badge, so the two counts agree', () => {
		const statuses = [
			'DISTRIBUTING',
			'SHIFT_CLOSED',
			'RETURN_PENDING_RECEIPT',
			'RETURN_COMPLETED',
			'COMPLETED'
		] as const;
		for (const status of statuses) {
			expect(closeOutGroup(status) === 'action').toBe(
				status === 'DISTRIBUTING' || needsCloseOutAction({ status })
			);
		}
	});
});

describe('resolveCloseOutGroup', () => {
	const tickets = [
		{ _id: 'a', status: 'RETURN_PENDING_RECEIPT' as const },
		{ _id: 'b', status: 'COMPLETED' as const }
	];

	it('keeps the picked group while it has tickets', () => {
		expect(resolveCloseOutGroup('done', tickets, '')).toBe('done');
	});

	it('follows a pinned ticket into its new group', () => {
		expect(resolveCloseOutGroup(null, tickets, 'b')).toBe('done');
	});

	it('lets the pinned ticket win once the picked group has emptied', () => {
		expect(resolveCloseOutGroup('action', tickets, 'b')).toBe('done');
	});

	it('opens on the first group with tickets, action first', () => {
		expect(resolveCloseOutGroup(null, tickets, '')).toBe('waiting');
		expect(resolveCloseOutGroup('action', tickets, '')).toBe('waiting');
		expect(
			resolveCloseOutGroup(null, [...tickets, { _id: 'c', status: 'SHIFT_CLOSED' as const }], '')
		).toBe('action');
	});
});
