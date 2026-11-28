import { describe, expect, it } from 'vitest';
import { catalogHistoryScope } from './catalog-history';

const central = {};
const local = { shelter_code: 'SH001' };
const override = { shelter_code: 'SH001', override: true };

describe('catalogHistoryScope', () => {
	it('hides the panel until the doc is loaded', () => {
		expect(catalogHistoryScope(null, { isSystemAdmin: true, shelterCode: null })).toEqual({
			visible: false
		});
	});

	it.each([
		['local', local],
		['override', override]
	])('shows a %s row to a shelter manager, scoped to that shelter', (_label, doc) => {
		expect(catalogHistoryScope(doc, { isSystemAdmin: false, shelterCode: 'SH001' })).toEqual({
			visible: true,
			shelterCode: 'SH001'
		});
	});

	it('scopes a system admin working in a shelter to that shelter for its own row', () => {
		expect(catalogHistoryScope(local, { isSystemAdmin: true, shelterCode: 'SH001' })).toEqual({
			visible: true,
			shelterCode: 'SH001'
		});
	});

	it('hides a central row from a shelter manager, whose reads are pinned to a shelter', () => {
		expect(catalogHistoryScope(central, { isSystemAdmin: false, shelterCode: 'SH001' })).toEqual({
			visible: false
		});
	});

	it("treats another shelter's row as central for this viewer", () => {
		expect(catalogHistoryScope(local, { isSystemAdmin: false, shelterCode: 'SH002' })).toEqual({
			visible: false
		});
	});

	it('shows a central row to a system admin, unfiltered', () => {
		expect(catalogHistoryScope(central, { isSystemAdmin: true, shelterCode: undefined })).toEqual({
			visible: true,
			shelterCode: null
		});
	});
});
