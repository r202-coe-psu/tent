import { describe, expect, it } from 'vitest';
import { PORTAL_DEPARTMENTS, PORTAL_GROUP_LABELS, PORTAL_PUBLIC_LINK } from './portal-menu';
import {
	portalDepartmentText,
	portalGroupLabel,
	portalItemText,
	portalMenuLabelsEn,
	portalPublicLinkLabel
} from './portal-menu-labels';

const THAI = /[฀-๿]/;
const allItems = PORTAL_DEPARTMENTS.flatMap((d) => d.items);

describe('portal menu EN mirror', () => {
	it('covers every department and item id exactly', () => {
		expect(Object.keys(portalMenuLabelsEn.departments).sort()).toEqual(
			PORTAL_DEPARTMENTS.map((d) => d.id).sort()
		);
		expect(Object.keys(portalMenuLabelsEn.items).sort()).toEqual(allItems.map((i) => i.id).sort());
		expect(Object.keys(portalMenuLabelsEn.groups).sort()).toEqual(
			Object.keys(PORTAL_GROUP_LABELS).sort()
		);
	});

	it('has no Thai characters in any EN text', () => {
		const texts = [
			...Object.values(portalMenuLabelsEn.departments).flatMap((t) => [t.label, t.desc]),
			...Object.values(portalMenuLabelsEn.items).flatMap((t) => [t.label, t.desc]),
			...Object.values(portalMenuLabelsEn.groups),
			portalMenuLabelsEn.publicLink
		];
		for (const text of texts) {
			expect(text.length).toBeGreaterThan(0);
			expect(text).not.toMatch(THAI);
		}
	});

	it('returns the Thai source untouched for th and when no language is given', () => {
		for (const dept of PORTAL_DEPARTMENTS) {
			expect(portalDepartmentText(dept, 'th')).toEqual({ label: dept.label, desc: dept.desc });
			expect(portalDepartmentText(dept)).toEqual({ label: dept.label, desc: dept.desc });
		}
		for (const item of allItems) {
			expect(portalItemText(item, 'th')).toEqual({ label: item.label, desc: item.desc });
		}
		expect(portalGroupLabel('stations', 'th')).toBe(PORTAL_GROUP_LABELS.stations);
		expect(portalPublicLinkLabel('th')).toBe(PORTAL_PUBLIC_LINK.label);
	});

	it('returns English for en', () => {
		expect(portalDepartmentText(PORTAL_DEPARTMENTS[0], 'en').label).toBe('Registration');
		expect(portalItemText(allItems[0], 'en').label).toBe('Register Families and Households');
		expect(portalGroupLabel('tools', 'en')).toBe('Registration tools');
		expect(portalPublicLinkLabel('en')).toBe('Public service website');
	});
});
