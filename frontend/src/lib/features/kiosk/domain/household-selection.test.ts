import { describe, expect, it } from 'vitest';
import { initialSelection, toExistingReportResults } from './household-selection';

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
				qr_payload: 'evacuee:arriving'
			}
		]);
	});
});
