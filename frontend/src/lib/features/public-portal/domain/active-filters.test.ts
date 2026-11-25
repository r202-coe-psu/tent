import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RADIUS_KM,
	RADIUS_PRESETS_KM,
	activeFilterChips,
	activeFilterCount,
	emptyListReason,
	isDefaultRadius,
	isRadiusActive,
	nextRadiusKm,
	paramsWithoutAllFilters,
	paramsWithoutFilter,
	paramsWithoutPosition,
	paramsWithRadius,
	showMapFilterOverlay,
	type ActiveFilterLabels
} from './active-filters';

const labels: ActiveFilterLabels = {
	radius: (km) => `ระยะ ${km} กม.`,
	search: (q) => `ค้นหา: "${q}"`,
	status: (value) => `สถานะ: ${value}`,
	type: (label) => `ประเภท: ${label}`,
	province: (name) => `จ.${name}`,
	district: (name) => `อ.${name}`,
	subdistrict: (name) => `ต.${name}`,
	hideFull: 'ซ่อนที่เต็ม',
	parking: { car: 'ที่จอดรถยนต์', motorcycle: 'ที่จอดจักรยานยนต์', boat: 'จุดจอดเรือ' },
	group: { all: 'รวมศูนย์ภายนอก', external: 'เฉพาะศูนย์ภายนอก' }
};

const AT = { user_lat: '7.0086', user_lng: '100.4968' };

describe('radius rules', () => {
	it('defines the default radius as 5 km, one of the presets', () => {
		expect(DEFAULT_RADIUS_KM).toBe('5');
		expect(RADIUS_PRESETS_KM).toEqual(['1', '2', '4', '5', '10']);
	});

	it('treats only "5" as the default; a cleared or other radius is not', () => {
		expect(isDefaultRadius('5')).toBe(true);
		expect(isDefaultRadius(' 5 ')).toBe(true);
		expect(isDefaultRadius('')).toBe(false);
		expect(isDefaultRadius('10')).toBe(false);
		expect(isDefaultRadius('5.5')).toBe(false);
		expect(isDefaultRadius(undefined)).toBe(false);
	});

	it('has a radius in effect only with a position and a positive distance (as the load does)', () => {
		expect(isRadiusActive({ ...AT, distance: '5' })).toBe(true);
		expect(isRadiusActive({ ...AT, distance: '' })).toBe(false);
		expect(isRadiusActive({ ...AT, distance: '0' })).toBe(false);
		expect(isRadiusActive({ ...AT, distance: 'abc' })).toBe(false);
		expect(isRadiusActive({ distance: '5' })).toBe(false);
		expect(isRadiusActive({ user_lat: '7', distance: '5' })).toBe(false);
	});

	it('expands to the next preset above the current radius, or clears it past the largest', () => {
		expect(nextRadiusKm('1')).toBe('2');
		expect(nextRadiusKm('4')).toBe('5');
		expect(nextRadiusKm('5')).toBe('10');
		expect(nextRadiusKm('3')).toBe('4');
		expect(nextRadiusKm('7.5')).toBe('10');
		expect(nextRadiusKm('10')).toBe('');
		expect(nextRadiusKm('25')).toBe('');
	});
});

describe('activeFilterChips', () => {
	it('gives no chips when nothing is filtered and there is no position', () => {
		expect(activeFilterChips({ distance: '5' }, labels)).toEqual([]);
	});

	it('shows the default 5 km radius as a chip, but does not count it', () => {
		const chips = activeFilterChips({ ...AT, distance: '5' }, labels);
		expect(chips).toEqual([
			{ key: 'radius', label: 'ระยะ 5 กม.', removes: ['distance'], counts: false }
		]);
		expect(activeFilterCount(chips)).toBe(0);
	});

	it('counts a radius the visitor changed', () => {
		const chips = activeFilterChips({ ...AT, distance: '10' }, labels);
		expect(chips).toEqual([
			{ key: 'radius', label: 'ระยะ 10 กม.', removes: ['distance'], counts: true }
		]);
		expect(activeFilterCount(chips)).toBe(1);
	});

	it('shows no radius chip when the radius was cleared', () => {
		expect(activeFilterChips({ ...AT, distance: '' }, labels)).toEqual([]);
	});

	it('builds one counted chip per active filter, in a stable order', () => {
		const chips = activeFilterChips(
			{
				...AT,
				distance: '5',
				search: '  โรงเรียน ',
				status: 'open',
				type: 'โรงเรียน',
				province: 'สงขลา',
				district: 'หาดใหญ่',
				subdistrict: 'คอหงส์',
				hide_full: 'true',
				parking_car: 'on',
				parking_motorcycle: 'on',
				parking_boat: 'on',
				show_external: 'on'
			},
			labels
		);
		expect(chips.map((c) => [c.key, c.label, c.counts])).toEqual([
			['search', 'ค้นหา: "โรงเรียน"', true],
			['radius', 'ระยะ 5 กม.', false],
			['status', 'สถานะ: open', true],
			['type', 'ประเภท: โรงเรียน', true],
			['province', 'จ.สงขลา', true],
			['district', 'อ.หาดใหญ่', true],
			['subdistrict', 'ต.คอหงส์', true],
			['hide_full', 'ซ่อนที่เต็ม', true],
			['parking_car', 'ที่จอดรถยนต์', true],
			['parking_motorcycle', 'ที่จอดจักรยานยนต์', true],
			['parking_boat', 'จุดจอดเรือ', true],
			['group', 'รวมศูนย์ภายนอก', true]
		]);
		expect(activeFilterCount(chips)).toBe(11);
	});

	it('shows no group chip for the default pick, one chip for the others', () => {
		const key = (f: Record<string, string>) =>
			activeFilterChips(f, labels)
				.filter((c) => c.key === 'group')
				.map((c) => c.label);
		expect(key({})).toEqual([]);
		expect(key({ hide_evacuation: 'on' })).toEqual([]);
		expect(key({ show_external: 'on' })).toEqual(['รวมศูนย์ภายนอก']);
		expect(key({ show_external: 'on', hide_evacuation: 'on' })).toEqual(['เฉพาะศูนย์ภายนอก']);
	});

	it('removes the lower areas together with a province or a district', () => {
		const chips = activeFilterChips(
			{ province: 'สงขลา', district: 'หาดใหญ่', subdistrict: 'คอหงส์' },
			labels
		);
		const removes = Object.fromEntries(chips.map((c) => [c.key, c.removes]));
		expect(removes).toEqual({
			province: ['province', 'district', 'subdistrict'],
			district: ['district', 'subdistrict'],
			subdistrict: ['subdistrict']
		});
	});

	it('reads the search from `q`, the first status only, and accepts boolean flags', () => {
		const chips = activeFilterChips(
			{ search: 'วัด', status: 'FULL,open', hide_full: true, parking_car: true },
			labels
		);
		expect(chips.map((c) => [c.key, c.removes])).toEqual([
			['search', ['q']],
			['status', ['status']],
			['hide_full', ['hide_full']],
			['parking_car', ['parking_car']]
		]);
		expect(chips[1].label).toBe('สถานะ: full');
	});

	it('ignores blank and "off" values', () => {
		expect(
			activeFilterChips(
				{ search: '   ', status: '', hide_full: '', parking_boat: '', show_external: false },
				labels
			)
		).toEqual([]);
	});
});

describe('emptyListReason', () => {
	it('is "radius" when the radius is the only thing narrowing the list', () => {
		expect(emptyListReason(activeFilterChips({ ...AT, distance: '5' }, labels))).toBe('radius');
		expect(emptyListReason(activeFilterChips({ ...AT, distance: '10' }, labels))).toBe('radius');
	});

	it('is "filtered" when another filter is on, with or without a radius', () => {
		expect(
			emptyListReason(activeFilterChips({ ...AT, distance: '5', hide_full: 'true' }, labels))
		).toBe('filtered');
		expect(emptyListReason(activeFilterChips({ search: 'วัด' }, labels))).toBe('filtered');
	});

	it('is "none" when nothing narrows the list', () => {
		expect(emptyListReason([])).toBe('none');
	});
});

describe('URL edits', () => {
	const url = (qs: string) => new URLSearchParams(qs);

	it('drops the keys of the removed chip and keeps the rest', () => {
		const chips = activeFilterChips(
			{ ...AT, distance: '5', province: 'สงขลา', district: 'หาดใหญ่', hide_full: 'true' },
			labels
		);
		const province = chips.find((c) => c.key === 'province')!;
		const next = paramsWithoutFilter(
			url(
				'user_lat=7.0086&user_lng=100.4968&distance=5&province=สงขลา&district=หาดใหญ่&hide_full=true'
			),
			province
		);
		expect(next.toString()).toBe(
			url('user_lat=7.0086&user_lng=100.4968&distance=5&hide_full=true').toString()
		);
	});

	it('writes `distance=` (cleared) for the radius chip, never drops it back to the default', () => {
		const [radius] = activeFilterChips({ ...AT, distance: '5' }, labels);
		const next = paramsWithoutFilter(url('user_lat=7&user_lng=100&distance=5'), radius);
		expect(next.has('distance')).toBe(true);
		expect(next.get('distance')).toBe('');
		expect(next.get('user_lat')).toBe('7');
	});

	it('clears every counted filter, keeps the position and the default radius', () => {
		const qs =
			'user_lat=7&user_lng=100&distance=5&q=วัด&status=open&province=สงขลา&district=หาดใหญ่&hide_full=true&parking_car=on&show_external=on&hide_evacuation=on';
		const filters = {
			user_lat: '7',
			user_lng: '100',
			distance: '5',
			search: 'วัด',
			status: 'open',
			province: 'สงขลา',
			district: 'หาดใหญ่',
			hide_full: 'true',
			parking_car: 'on',
			show_external: 'on',
			hide_evacuation: 'on'
		};
		const next = paramsWithoutAllFilters(url(qs), activeFilterChips(filters, labels));
		expect(Object.fromEntries(next)).toEqual({ user_lat: '7', user_lng: '100', distance: '5' });
	});

	it('puts a changed radius back to the default when clearing everything', () => {
		const filters = { user_lat: '7', user_lng: '100', distance: '10', hide_full: 'true' };
		const next = paramsWithoutAllFilters(
			url('user_lat=7&user_lng=100&distance=10&hide_full=true'),
			activeFilterChips(filters, labels)
		);
		expect(Object.fromEntries(next)).toEqual({ user_lat: '7', user_lng: '100', distance: '5' });
	});

	it('removes the position and its radius together', () => {
		const next = paramsWithoutPosition(url('user_lat=13.7442&user_lng=100.4608&distance=5&q=วัด'));
		expect(Object.fromEntries(next)).toEqual({ q: 'วัด' });
	});

	it('sets a radius, or clears it with an empty value', () => {
		expect(paramsWithRadius(url('user_lat=7&distance=5'), '10').get('distance')).toBe('10');
		const cleared = paramsWithRadius(url('user_lat=7&distance=10'), '');
		expect(cleared.has('distance')).toBe(true);
		expect(cleared.get('distance')).toBe('');
	});

	it('never changes the params it was given', () => {
		const original = url('user_lat=7&user_lng=100&distance=5');
		paramsWithoutPosition(original);
		paramsWithRadius(original, '10');
		expect(original.toString()).toBe('user_lat=7&user_lng=100&distance=5');
	});
});

describe('showMapFilterOverlay (desktop, list panel collapsed)', () => {
	it('never shows while the list panel is open: the panel has the chips and the empty state', () => {
		expect(showMapFilterOverlay({ listPanelOpen: true, chipCount: 3, resultCount: 0 })).toBe(false);
	});

	it('shows on the map when the list panel is collapsed and a filter is on', () => {
		expect(showMapFilterOverlay({ listPanelOpen: false, chipCount: 1, resultCount: 7 })).toBe(true);
	});

	it('shows on the map when the list panel is collapsed and nothing was found', () => {
		expect(showMapFilterOverlay({ listPanelOpen: false, chipCount: 0, resultCount: 0 })).toBe(true);
	});

	it('stays away when collapsed, nothing is filtered and shelters are found', () => {
		expect(showMapFilterOverlay({ listPanelOpen: false, chipCount: 0, resultCount: 7 })).toBe(
			false
		);
	});
});
