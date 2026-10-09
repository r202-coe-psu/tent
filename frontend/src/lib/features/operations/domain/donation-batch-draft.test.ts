import { describe, expect, it } from 'vitest';
import { draftProblem, initialBatchDrafts, isReceivedDraft } from './donation-batch-draft';
import { createWalkInDonation, type Donation } from './operations';
import { initialExpiryState } from './lot-expiry';

const donation: Donation = createWalkInDonation(
	{
		donor: { name: 'ผู้ใจบุญ', phone: null, phone_hash: 'h' },
		kind: 'items',
		items: [
			{ item_id: 'item:rice', qty: '10', unit: 'kg' },
			{ free_text: 'ปลากระป๋อง', qty: '24', unit: 'กระป๋อง' }
		],
		tracking_token_hash: 't'
	},
	{ shelterCode: 'SH001', createdBy: 'staff' }
);

describe('initialBatchDrafts (CR-143 FR-B1 / FR-B2)', () => {
	it('fills one line per ticket item with "received" defaulting to the declared qty', () => {
		const drafts = initialBatchDrafts(donation);
		expect(drafts.map((d) => [d.line_no, d.item_id, d.qty, d.declared_qty])).toEqual([
			[0, 'item:rice', '10', '10'],
			[1, '', '24', '24']
		]);
		expect(drafts.every((d) => !d.locked)).toBe(true);
	});

	it('keeps the donor wording of a free_text line that still needs matching', () => {
		const [, freeText] = initialBatchDrafts(donation);
		expect(freeText.free_text).toBe('ปลากระป๋อง');
		expect(freeText.item_id).toBe('');
	});
});

describe('draftProblem', () => {
	const draft = (over: Partial<ReturnType<typeof initialBatchDrafts>[number]> = {}) => ({
		...initialBatchDrafts(donation)[0],
		...over
	});

	it('a zero line is fine without an item or expiry (FR-B3)', () => {
		expect(draftProblem(draft({ item_id: '', qty: '0' }), true)).toBeNull();
		expect(isReceivedDraft({ qty: '0' })).toBe(false);
	});

	it('flags a blank or negative quantity', () => {
		expect(draftProblem(draft({ qty: '' }), false)).toBe('qty');
		expect(draftProblem(draft({ qty: '-1' }), false)).toBe('qty');
	});

	it('flags a received line that is not matched to an item (FR-B2)', () => {
		expect(draftProblem(draft({ item_id: '' }), false)).toBe('item');
	});

	it('flags a missing expiry only when the item requires one (FR-D2)', () => {
		expect(draftProblem(draft(), true)).toBe('expiry');
		expect(draftProblem(draft(), false)).toBeNull();
		expect(
			draftProblem(draft({ expiry: { ...initialExpiryState(), value: '2027-01-31' } }), true)
		).toBeNull();
	});

	it('does not ask for the expiry of a line that is already in the ledger', () => {
		expect(draftProblem(draft({ locked: true }), true)).toBeNull();
	});
});
