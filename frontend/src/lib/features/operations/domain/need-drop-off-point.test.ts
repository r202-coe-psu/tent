import { describe, expect, it } from 'vitest';
import { needPointBadge, needPointToSave, resolveNeedPointField } from './need-drop-off-point';

const gym = { id: 'p-gym', name: 'โรงยิม' };
const med = { id: 'p-med', name: 'ห้องพยาบาล' };

describe('resolveNeedPointField', () => {
	it('hides the field and stores null when the shelter has no points', () => {
		expect(resolveNeedPointField([])).toEqual({ mode: 'none', value: null });
		expect(resolveNeedPointField([], 'p-old')).toEqual({ mode: 'none', value: null });
	});

	it('picks the only point, even over a stale stored id', () => {
		expect(resolveNeedPointField([gym])).toEqual({ mode: 'auto', value: 'p-gym' });
		expect(resolveNeedPointField([gym], 'p-old')).toEqual({ mode: 'auto', value: 'p-gym' });
	});

	it('requires a choice with two or more points, starting empty on create', () => {
		expect(resolveNeedPointField([gym, med])).toEqual({ mode: 'required', value: null });
	});

	it('keeps a stored point that is still current', () => {
		expect(resolveNeedPointField([gym, med], 'p-med')).toEqual({
			mode: 'required',
			value: 'p-med'
		});
	});

	it('starts empty for a null or deleted stored point', () => {
		expect(resolveNeedPointField([gym, med], null).value).toBeNull();
		expect(resolveNeedPointField([gym, med], undefined).value).toBeNull();
		expect(resolveNeedPointField([gym, med], 'p-gone').value).toBeNull();
	});
});

describe('needPointToSave', () => {
	it('is null for none and the point for auto, whatever was chosen', () => {
		expect(needPointToSave({ mode: 'none', value: null }, null)).toBeNull();
		expect(needPointToSave({ mode: 'auto', value: 'p-gym' }, null)).toBe('p-gym');
	});

	it('is undefined (cannot save) until a required point is chosen', () => {
		const field = resolveNeedPointField([gym, med]);
		expect(needPointToSave(field, null)).toBeUndefined();
		expect(needPointToSave(field, '')).toBeUndefined();
		expect(needPointToSave(field, 'p-med')).toBe('p-med');
	});
});

describe('needPointBadge', () => {
	it('flags nothing when the shelter has no points', () => {
		expect(needPointBadge([], null)).toBeNull();
		expect(needPointBadge([], 'p-old')).toBeNull();
	});

	it('flags a null need as unset and a missing id as deleted', () => {
		expect(needPointBadge([gym], null)).toBe('unset');
		expect(needPointBadge([gym], undefined)).toBe('unset');
		expect(needPointBadge([gym], 'p-gone')).toBe('deleted');
		expect(needPointBadge([gym, med], 'p-gym')).toBeNull();
	});
});
