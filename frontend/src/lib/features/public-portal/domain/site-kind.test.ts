import { describe, expect, it } from 'vitest';
import {
	activeSiteKinds,
	countBySiteKind,
	isHostHouseKind,
	normalizeSiteKind,
	siteKindLabel,
	siteKindTiles,
	type SiteKindOption
} from './site-kind';

const KINDS: SiteKindOption[] = [
	{
		code: 'evacuation_center',
		label_th: 'ศูนย์อพยพ',
		label_en: 'Evacuation Center',
		status: 'active'
	},
	{ code: 'host_house', label_th: 'บ้านพี่เลี้ยง', label_en: 'Host House', status: 'active' },
	{
		code: 'field_hospital',
		label_th: 'โรงพยาบาลสนาม',
		label_en: 'Field Hospital',
		status: 'active'
	},
	{ code: 'old_camp', label_th: 'ค่ายเก่า', label_en: 'Old Camp', status: 'inactive' }
];

describe('siteKindLabel', () => {
	it('labels by language from the master list', () => {
		expect(siteKindLabel('field_hospital', KINDS, 'th')).toBe('โรงพยาบาลสนาม');
		expect(siteKindLabel('field_hospital', KINDS, 'en')).toBe('Field Hospital');
	});

	it('still labels an inactive code', () => {
		expect(siteKindLabel('old_camp', KINDS, 'th')).toBe('ค่ายเก่า');
	});

	it('prefers an edited master label over the seeded wording', () => {
		const edited = [{ ...KINDS[0], label_th: 'ศูนย์พักพิง' }];
		expect(siteKindLabel('evacuation_center', edited, 'th')).toBe('ศูนย์พักพิง');
	});

	it('shows the code when no label is known', () => {
		expect(siteKindLabel('mobile_clinic', KINDS, 'th')).toBe('mobile_clinic');
		expect(siteKindLabel('mobile_clinic', [], 'en')).toBe('mobile_clinic');
	});

	it('keeps the two seeded labels readable while the list is empty or loading', () => {
		expect(siteKindLabel('host_house', undefined, 'th')).toBe('บ้านพี่เลี้ยง');
		expect(siteKindLabel('evacuation_center', [], 'en')).toBe('Evacuation Center');
	});

	it('reads a missing code as the default kind', () => {
		expect(siteKindLabel(undefined, KINDS, 'en')).toBe('Evacuation Center');
		expect(siteKindLabel('  ', KINDS, 'th')).toBe('ศูนย์อพยพ');
	});
});

describe('activeSiteKinds', () => {
	it('drops inactive items and tolerates a missing list', () => {
		expect(activeSiteKinds(KINDS).map((k) => k.code)).toEqual([
			'evacuation_center',
			'host_house',
			'field_hospital'
		]);
		expect(activeSiteKinds(undefined)).toEqual([]);
	});
});

describe('isHostHouseKind / normalizeSiteKind', () => {
	it('only host_house gets the host-house pin', () => {
		expect(isHostHouseKind('host_house')).toBe(true);
		expect(isHostHouseKind('field_hospital')).toBe(false);
		expect(isHostHouseKind('evacuation_center')).toBe(false);
		expect(isHostHouseKind(undefined)).toBe(false);
	});

	it('defaults a missing code to evacuation_center', () => {
		expect(normalizeSiteKind(undefined)).toBe('evacuation_center');
		expect(normalizeSiteKind('')).toBe('evacuation_center');
		expect(normalizeSiteKind('field_hospital')).toBe('field_hospital');
	});
});

describe('countBySiteKind', () => {
	it('counts every code and treats a missing one as the default kind', () => {
		expect(
			countBySiteKind([
				{ site_kind: 'host_house' },
				{ site_kind: 'field_hospital' },
				{ site_kind: 'field_hospital' },
				{}
			])
		).toEqual({ host_house: 1, field_hospital: 2, evacuation_center: 1 });
	});
});

describe('siteKindTiles', () => {
	it('lists active kinds in master order, including zero counts', () => {
		expect(siteKindTiles({ host_house: 2 }, KINDS)).toEqual([
			{ code: 'evacuation_center', count: 0 },
			{ code: 'host_house', count: 2 },
			{ code: 'field_hospital', count: 0 }
		]);
	});

	it('adds an inactive or unknown code only when shelters use it, after the master items', () => {
		expect(siteKindTiles({ old_camp: 1, mobile_clinic: 3, evacuation_center: 4 }, KINDS)).toEqual([
			{ code: 'evacuation_center', count: 4 },
			{ code: 'host_house', count: 0 },
			{ code: 'field_hospital', count: 0 },
			{ code: 'old_camp', count: 1 },
			{ code: 'mobile_clinic', count: 3 }
		]);
	});

	it('falls back to the counted codes when the master list is empty', () => {
		expect(siteKindTiles({ host_house: 1 }, [])).toEqual([{ code: 'host_house', count: 1 }]);
	});
});
