import { describe, expect, it } from 'vitest';
import { STAFF_REGISTRATION_DESK_I18N } from './staff-registration-desk';

const THAI = /[฀-๿]/;

function flatten(value: unknown, path: string, out: Map<string, unknown>): void {
	if (typeof value === 'function') {
		out.set(path, (value as (...args: unknown[]) => unknown)(1, 2, 3, 'x'));
	} else if (value && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, path ? `${path}.${key}` : key, out);
		}
	} else {
		out.set(path, value);
	}
}

describe('STAFF_REGISTRATION_DESK_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const th = new Map<string, unknown>();
		const en = new Map<string, unknown>();
		flatten(STAFF_REGISTRATION_DESK_I18N.th, '', th);
		flatten(STAFF_REGISTRATION_DESK_I18N.en, '', en);
		expect([...en.keys()].sort()).toEqual([...th.keys()].sort());
		const thai = [...en.entries()].filter(([, v]) => typeof v === 'string' && THAI.test(v));
		expect(thai).toEqual([]);
	});

	it('keeps the Thai interpolations byte-identical to the original copy', () => {
		const t = STAFF_REGISTRATION_DESK_I18N.th;
		expect(t.walkIn.matchedMember(2, 'สมชาย')).toBe('สมาชิกคนที่ 2 — สมชาย');
		expect(t.walkIn.matchedMember(1, '')).toBe('สมาชิกคนที่ 1');
		expect(t.unassigned.petCapError(5, 3, 2, 'x')).toBe(
			'สัตว์เลี้ยงของครัวเรือนนี้จะรวมเป็น 5 ตัว เกินเพดาน 3 ตัวต่อครัวเรือนอยู่ 2 ตัว — x'
		);
		expect(t.reportIn.pageTitle(null)).toBe('รายงานตัว');
	});
});
