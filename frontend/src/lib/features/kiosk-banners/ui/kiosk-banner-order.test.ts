import { describe, expect, it } from 'vitest';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
import {
	dropIndex,
	moveItem,
	reconcileDraft,
	sameOrder,
	summarizeScreen
} from './kiosk-banner-order';

describe('moveItem', () => {
	it('moves an item up so it ends at the target index', () => {
		expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
	});

	it('moves an item down so it ends at the target index', () => {
		expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
	});

	it('returns an unchanged copy when from equals to or an index is out of range', () => {
		const list = ['a', 'b', 'c'];
		for (const [from, to] of [
			[1, 1],
			[-1, 0],
			[3, 0],
			[0, -1],
			[0, 3]
		]) {
			const result = moveItem(list, from, to);
			expect(result).toEqual(['a', 'b', 'c']);
			expect(result).not.toBe(list);
		}
	});

	it('does not mutate the input', () => {
		const list = ['a', 'b', 'c'];
		moveItem(list, 2, 0);
		expect(list).toEqual(['a', 'b', 'c']);
	});
});

describe('dropIndex', () => {
	it('counts the row midpoints above the pointer', () => {
		expect(dropIndex([10, 30, 50], 5)).toBe(0);
		expect(dropIndex([10, 30, 50], 20)).toBe(1);
		expect(dropIndex([10, 30, 50], 60)).toBe(3);
	});

	it('does not count a midpoint exactly at the pointer', () => {
		expect(dropIndex([10, 30, 50], 30)).toBe(1);
	});

	it('is 0 when there are no other rows', () => {
		expect(dropIndex([], 100)).toBe(0);
	});
});

describe('sameOrder', () => {
	const row = (_id: string) => ({ _id });

	it('is true when both lists hold the same ids in the same sequence', () => {
		expect(sameOrder([row('a'), row('b')], [row('a'), row('b')])).toBe(true);
		expect(sameOrder([], [])).toBe(true);
	});

	it('is false when the sequence differs', () => {
		expect(sameOrder([row('a'), row('b')], [row('b'), row('a')])).toBe(false);
	});

	it('is false when the lengths differ', () => {
		expect(sameOrder([row('a')], [row('a'), row('b')])).toBe(false);
	});
});

describe('reconcileDraft', () => {
	const row = (_id: string, _rev = '1') => ({ _id, _rev });

	it('keeps the draft sequence but returns the saved objects', () => {
		const draft = [row('b'), row('a')];
		const saved = [row('a', '2'), row('b', '3')];
		expect(reconcileDraft(draft, saved)).toEqual([row('b', '3'), row('a', '2')]);
	});

	it('drops an id that is no longer saved', () => {
		const draft = [row('c'), row('b'), row('a')];
		const saved = [row('a'), row('c')];
		expect(reconcileDraft(draft, saved)).toEqual([row('c'), row('a')]);
	});

	it('appends a newly saved id at the end', () => {
		const draft = [row('b'), row('a')];
		const saved = [row('a'), row('b'), row('c')];
		expect(reconcileDraft(draft, saved)).toEqual([row('b'), row('a'), row('c')]);
	});

	it('handles a deleted id and a new id together, appending new ids in saved order', () => {
		const draft = [row('c'), row('a'), row('b')];
		const saved = [row('d'), row('a'), row('e'), row('b')];
		expect(reconcileDraft(draft, saved)).toEqual([row('a'), row('b'), row('d'), row('e')]);
	});

	it('returns the saved list for an empty draft', () => {
		const saved = [row('b', '2'), row('a', '5')];
		expect(reconcileDraft([], saved)).toEqual([row('b', '2'), row('a', '5')]);
	});
});

describe('summarizeScreen', () => {
	const NOW = new Date('2026-10-15T05:00:00.000Z');

	const banner = (
		id: string,
		over: Partial<Omit<KioskBannerSummary, 'schema_v'>> = {}
	): KioskBannerSummary => ({
		_id: `kiosk_banner:${id}`,
		_rev: `1-${id}`,
		type: 'kiosk_banner',
		schema_v: 2,
		group_id: 'kiosk_banner_group:A',
		shelter_code: 'SH001',
		title: `banner ${id}`,
		caption: null,
		order: 1,
		duration_sec: 10,
		start_at: '2026-10-15T01:00:00.000Z',
		end_at: '2026-10-15T11:00:00.000Z',
		status: 'active',
		created_at: '2026-10-14T00:00:00.000Z',
		updated_at: '2026-10-14T00:00:00.000Z',
		created_by: 'tester',
		image_content_type: 'image/png',
		...over
	});
	const GROUP_A = 'kiosk_banner_group:A';
	const slot = (screen_type: 'compact' | 'portrait') => ({ group_id: GROUP_A, screen_type });
	const expiredOver = {
		start_at: '2026-10-10T01:00:00.000Z',
		end_at: '2026-10-12T01:00:00.000Z'
	};

	// compact: legacy (no screen_type), active, inactive, scheduled; portrait: one active
	const current = [
		banner('inactive', { screen_type: 'compact', order: 3, status: 'inactive' }),
		banner('portrait', { screen_type: 'portrait', order: 1 }),
		banner('scheduled', {
			screen_type: 'compact',
			order: 4,
			start_at: '2026-10-15T08:00:00.000Z'
		}),
		banner('active', { screen_type: 'compact', order: 2 }),
		banner('legacy', { order: 1 })
	];
	const expired = [
		banner('old-compact', { screen_type: 'compact', ...expiredOver }),
		banner('old-legacy', { ...expiredOver }),
		banner('old-portrait', { screen_type: 'portrait', ...expiredOver })
	];

	it('counts the compact screen, treating a doc without screen_type as compact', () => {
		const summary = summarizeScreen(current, expired, slot('compact'), NOW);
		expect({
			active: summary.active,
			scheduled: summary.scheduled,
			inactive: summary.inactive,
			expired: summary.expired
		}).toEqual({ active: 2, scheduled: 1, inactive: 1, expired: 2 });
		expect(summary.strip.map((b) => b._id)).toEqual([
			'kiosk_banner:legacy',
			'kiosk_banner:active',
			'kiosk_banner:inactive',
			'kiosk_banner:scheduled'
		]);
	});

	it('counts the portrait screen on its own', () => {
		const summary = summarizeScreen(current, expired, slot('portrait'), NOW);
		expect({
			active: summary.active,
			scheduled: summary.scheduled,
			inactive: summary.inactive,
			expired: summary.expired
		}).toEqual({ active: 1, scheduled: 0, inactive: 0, expired: 1 });
		expect(summary.strip.map((b) => b._id)).toEqual(['kiosk_banner:portrait']);
	});

	it('ignores banners of another group and ungrouped (v1) banners', () => {
		const GROUP_B = 'kiosk_banner_group:B';
		const summary = summarizeScreen(
			[
				...current,
				banner('b-active', { group_id: GROUP_B, screen_type: 'compact', order: 1 }),
				{
					...banner('v1', { group_id: undefined, screen_type: 'compact', order: 1 }),
					schema_v: 1 as const
				}
			],
			[...expired, banner('b-old', { group_id: GROUP_B, ...expiredOver })],
			slot('compact'),
			NOW
		);
		expect({
			active: summary.active,
			scheduled: summary.scheduled,
			inactive: summary.inactive,
			expired: summary.expired
		}).toEqual({ active: 2, scheduled: 1, inactive: 1, expired: 2 });
		expect(summary.strip.map((b) => b._id)).toEqual([
			'kiosk_banner:legacy',
			'kiosk_banner:active',
			'kiosk_banner:inactive',
			'kiosk_banner:scheduled'
		]);
	});

	it('is all zeros with an empty strip when there are no banners', () => {
		expect(summarizeScreen([], [], slot('compact'), NOW)).toEqual({
			active: 0,
			scheduled: 0,
			inactive: 0,
			expired: 0,
			strip: []
		});
	});
});
