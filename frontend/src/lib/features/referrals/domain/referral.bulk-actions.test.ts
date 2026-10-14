import { describe, expect, it } from 'vitest';
import {
	getCommonActions,
	getReferralActions,
	getRowSelectability,
	getSelectAllIds,
	getSelectAllStatus
} from './referral.bulk-actions';
import type { Referral, ReferralStatus } from './referral.schema';

const SRC = 'SH001';
const DEST = 'SH002';

function make(
	id: string,
	status: ReferralStatus,
	overrides: Record<string, unknown> = {}
): Referral {
	return {
		_id: id,
		type: 'referral',
		referral_type: 'capacity',
		shelter_code: SRC,
		to_shelter_code: DEST,
		status,
		evacuee_id: `evacuee:${id}`,
		...overrides
	} as unknown as Referral;
}

const incoming = (id: string, status: ReferralStatus) =>
	make(id, status, { shelter_code: DEST, to_shelter_code: SRC });

describe('getReferralActions', () => {
	it('outgoing capacity: draft → send / cancel draft', () => {
		expect(getReferralActions(make('a', 'draft'), SRC)).toEqual(['send', 'cancel_draft']);
	});
	it('outgoing capacity: sent → withdraw only', () => {
		expect(getReferralActions(make('a', 'sent'), SRC)).toEqual(['withdraw']);
	});
	it.each(['accepted', 'rejected'] as const)('outgoing capacity: %s → close', (status) => {
		expect(getReferralActions(make('a', status), SRC)).toEqual(['close']);
	});
	it('outgoing capacity: closed has no action', () => {
		expect(getReferralActions(make('a', 'closed'), SRC)).toEqual([]);
	});
	it('incoming capacity: sent → accept / reject', () => {
		expect(getReferralActions(incoming('a', 'sent'), SRC)).toEqual(['accept', 'reject']);
	});
	it.each(['draft', 'accepted', 'rejected', 'closed'] as const)(
		'incoming capacity: %s → destination cannot act',
		(status) => {
			expect(getReferralActions(incoming('a', status), SRC)).toEqual([]);
		}
	);
	it('medical: source shelter can send, withdraw and respond', () => {
		const medical = (status: ReferralStatus) =>
			make('m', status, { referral_type: 'medical-emergency', to_shelter_code: undefined });
		expect(getReferralActions(medical('draft'), SRC)).toEqual(['send', 'cancel_draft']);
		expect(getReferralActions(medical('sent'), SRC)).toEqual(['accept', 'reject', 'withdraw']);
	});
});

describe('getRowSelectability', () => {
	it('rows with no action get no checkbox', () => {
		expect(getRowSelectability(make('a', 'closed'), null, SRC)).toBe('no-actions');
		expect(getRowSelectability(incoming('a', 'accepted'), 'sent', SRC)).toBe('no-actions');
	});
	it('anything actionable is selectable while nothing is selected', () => {
		expect(getRowSelectability(make('a', 'draft'), null, SRC)).toBe('selectable');
		expect(getRowSelectability(make('a', 'accepted'), null, SRC)).toBe('selectable');
	});
	it('blocks a different status once a status is selected', () => {
		expect(getRowSelectability(make('a', 'accepted'), 'draft', SRC)).toBe('other-status');
		expect(getRowSelectability(make('a', 'draft'), 'draft', SRC)).toBe('selectable');
	});
});

describe('select all', () => {
	const members = [
		make('closed', 'closed'),
		make('d1', 'draft'),
		make('acc', 'accepted'),
		make('d2', 'draft')
	];
	it('with nothing selected picks the first actionable status', () => {
		expect(getSelectAllStatus(members, null, SRC)).toBe('draft');
		expect(getSelectAllIds(members, null, SRC)).toEqual(['d1', 'd2']);
	});
	it('follows the status of the current selection', () => {
		expect(getSelectAllIds(members, 'accepted', SRC)).toEqual(['acc']);
	});
	it('is empty when nothing is actionable', () => {
		expect(getSelectAllIds([make('c', 'closed')], null, SRC)).toEqual([]);
		expect(getSelectAllStatus([], null, SRC)).toBeNull();
	});
});

describe('getCommonActions', () => {
	it('lists the actions every selected referral supports', () => {
		const labels = getCommonActions([make('a', 'draft'), make('b', 'draft')], SRC).map(
			(a) => a.label
		);
		expect(labels).toEqual(['ส่ง', 'ยกเลิกร่าง']);
	});
	it('exposes target status and reason policy per action', () => {
		const [send, cancel] = getCommonActions([make('a', 'draft')], SRC);
		expect(send).toMatchObject({ to: 'sent', asksReason: false });
		expect(cancel).toMatchObject({ to: 'closed', asksReason: true, destructive: true });
	});
	it('is empty for an empty selection', () => {
		expect(getCommonActions([], SRC)).toEqual([]);
	});
});
