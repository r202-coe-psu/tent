import { describe, expect, it } from 'vitest';
import { DeskDrafts, isHandoverDraft, isReturnedQtyDraft } from './desk-draft';

describe('isHandoverDraft', () => {
	it('is clean at the defaults the form resets to', () => {
		expect(isHandoverDraft({ qtyInput: '1', notesInput: '' })).toBe(false);
		expect(isHandoverDraft({ qtyInput: ' 1 ', notesInput: '  ' })).toBe(false);
	});

	it('is a draft once the quantity or notes are typed', () => {
		expect(isHandoverDraft({ qtyInput: '2', notesInput: '' })).toBe(true);
		expect(isHandoverDraft({ qtyInput: '', notesInput: '' })).toBe(true);
		expect(isHandoverDraft({ qtyInput: '1', notesInput: 'รับแทน' })).toBe(true);
	});
});

describe('isReturnedQtyDraft', () => {
	const initial = { 'item:a': '3', 'item:b': '0' };

	it('is clean while every quantity matches its prefilled value', () => {
		expect(isReturnedQtyDraft(initial, { ...initial })).toBe(false);
		expect(isReturnedQtyDraft(initial, {})).toBe(false);
	});

	it('is a draft once any quantity is edited', () => {
		expect(isReturnedQtyDraft(initial, { ...initial, 'item:a': '2' })).toBe(true);
		expect(isReturnedQtyDraft(initial, { ...initial, 'item:b': '' })).toBe(true);
	});
});

describe('DeskDrafts', () => {
	it('reports a draft only while a tracked form has one', () => {
		const drafts = new DeskDrafts();
		let dirty = false;
		const untrack = drafts.track(() => dirty);
		drafts.track(() => false);

		expect(drafts.hasDraft()).toBe(false);
		dirty = true;
		expect(drafts.hasDraft()).toBe(true);
		untrack();
		expect(drafts.hasDraft()).toBe(false);
	});
});
