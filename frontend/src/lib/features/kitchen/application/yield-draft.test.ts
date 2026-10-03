// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { clearYieldDraft, loadYieldDraft, saveYieldDraft } from './yield-draft';

const row = { key: 'k1', item_id: 'item_master:A', qty: '5', storage_point_id: '' };

describe('yield draft (sessionStorage)', () => {
	beforeEach(() => sessionStorage.clear());

	it('round-trips rows per meal_service', () => {
		saveYieldDraft('meal_service:1', [row]);
		expect(loadYieldDraft('meal_service:1')).toEqual([row]);
		expect(loadYieldDraft('meal_service:2')).toBeNull();
	});

	it('clears a draft', () => {
		saveYieldDraft('meal_service:1', [row]);
		clearYieldDraft('meal_service:1');
		expect(loadYieldDraft('meal_service:1')).toBeNull();
	});

	it('ignores corrupt or malformed storage', () => {
		sessionStorage.setItem('kitchen-yield-draft:meal_service:1', '{nope');
		expect(loadYieldDraft('meal_service:1')).toBeNull();
		sessionStorage.setItem('kitchen-yield-draft:meal_service:1', JSON.stringify([{ foo: 1 }]));
		expect(loadYieldDraft('meal_service:1')).toBeNull();
	});
});
