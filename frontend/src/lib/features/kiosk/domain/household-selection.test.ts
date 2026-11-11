import { describe, expect, it } from 'vitest';
import {
	canPrintQr,
	initialReprintSelection,
	initialSelection,
	isAllSelected,
	isQrIssueFailed,
	selectableIds,
	toExistingReportResults,
	toggleAllSelection
} from './household-selection';

const members = [
	{ evacuee_id: 'evacuee:head', is_primary: true, selectable: true, status: 'pre_registered' },
	{ evacuee_id: 'evacuee:member', is_primary: false, selectable: true, status: 'pre_registered' },
	{ evacuee_id: 'evacuee:arriving', is_primary: false, selectable: false, status: 'arriving' }
];

describe('initialSelection', () => {
	it('preselects all selectable members for phone lookup', () => {
		expect(initialSelection('phone', members)).toEqual(['evacuee:head', 'evacuee:member']);
	});

	it.each(['qr', 'smart-card'] as const)(
		'preselects the scanned member for %s lookup',
		(source) => {
			expect(initialSelection(source, members)).toEqual(['evacuee:head']);
		}
	);

	it('does not preselect a scanned member who is no longer selectable', () => {
		expect(initialSelection('qr', [members[2]])).toEqual([]);
	});
});

describe('toExistingReportResults', () => {
	it('returns every previously reported member and only reprints a QR for arriving members', () => {
		expect(
			toExistingReportResults([
				members[0],
				{ evacuee_id: 'evacuee:active', is_primary: false, selectable: false, status: 'active' },
				members[2]
			])
		).toEqual([
			{
				evacuee_id: 'evacuee:active',
				status: 'already_checked_in',
				stay_status: 'active'
			},
			{
				evacuee_id: 'evacuee:arriving',
				status: 'already_checked_in',
				stay_status: 'arriving',
				reprintable: true
			}
		]);
	});

	it('never carries a qr_payload: the bare evacuee id is not a QR any more (CR-233)', () => {
		for (const result of toExistingReportResults(members)) {
			expect(result).not.toHaveProperty('qr_payload');
		}
	});
});

describe('canPrintQr / isQrIssueFailed', () => {
	it('prints a member with a payload or a reissuable marker', () => {
		expect(canPrintQr({ qr_payload: 'evacuee:a@a1b2c3' })).toBe(true);
		expect(canPrintQr({ reprintable: true })).toBe(true);
	});

	it('never prints a qr_issue_failed member, even with a marker or payload', () => {
		expect(canPrintQr({ qr_issue_failed: true })).toBe(false);
		expect(canPrintQr({ qr_issue_failed: true, reprintable: true })).toBe(false);
		expect(canPrintQr({ qr_issue_failed: true, qr_payload: 'x' })).toBe(false);
		expect(isQrIssueFailed({ qr_issue_failed: true })).toBe(true);
		expect(isQrIssueFailed({})).toBe(false);
	});

	it('has nothing to print for a member without a payload or marker', () => {
		expect(canPrintQr({})).toBe(false);
	});
});

describe('initialReprintSelection', () => {
	it('ticks every prior report that still has a printable QR', () => {
		const results = toExistingReportResults([
			{ evacuee_id: 'evacuee:a', is_primary: true, selectable: false, status: 'arriving' },
			{ evacuee_id: 'evacuee:b', is_primary: false, selectable: false, status: 'room_confirmed' },
			{ evacuee_id: 'evacuee:c', is_primary: false, selectable: false, status: 'arriving' }
		]);
		expect(initialReprintSelection(results)).toEqual(['evacuee:a', 'evacuee:c']);
	});

	it('does not tick a member whose QR issue failed', () => {
		expect(
			initialReprintSelection([
				{ evacuee_id: 'evacuee:a', qr_issue_failed: true },
				{ evacuee_id: 'evacuee:b', qr_payload: 'evacuee:b@a1b2c3' }
			])
		).toEqual(['evacuee:b']);
	});
});

describe('select all', () => {
	it('lists only the selectable members, never the ones already reported', () => {
		expect(selectableIds(members)).toEqual(['evacuee:head', 'evacuee:member']);
	});

	it('ticks every selectable member when some or none are ticked', () => {
		expect(toggleAllSelection([], members)).toEqual(['evacuee:head', 'evacuee:member']);
		expect(toggleAllSelection(['evacuee:head'], members)).toEqual([
			'evacuee:head',
			'evacuee:member'
		]);
	});

	it('clears the selection when every selectable member is already ticked', () => {
		expect(toggleAllSelection(['evacuee:head', 'evacuee:member'], members)).toEqual([]);
	});

	it('reports all-selected only when there is something to select', () => {
		expect(isAllSelected(['evacuee:head', 'evacuee:member'], members)).toBe(true);
		expect(isAllSelected(['evacuee:head'], members)).toBe(false);
		expect(isAllSelected([], [members[2]])).toBe(false);
	});
});
