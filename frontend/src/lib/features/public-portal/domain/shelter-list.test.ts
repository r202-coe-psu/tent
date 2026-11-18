import { describe, expect, it } from 'vitest';
import { isShelterSelected } from './shelter-list';

describe('isShelterSelected', () => {
	const shelter = { id: 'shelter:1', code: 'SH001' };

	it('matches by id', () => {
		expect(isShelterSelected(shelter, 'shelter:1')).toBe(true);
	});

	it('matches by code', () => {
		expect(isShelterSelected(shelter, 'SH001')).toBe(true);
	});

	it('does not match another shelter or nothing selected', () => {
		expect(isShelterSelected(shelter, 'SH002')).toBe(false);
		expect(isShelterSelected(shelter, null)).toBe(false);
	});

	it('never matches an empty code to an empty selection', () => {
		expect(isShelterSelected({ id: 'x', code: '' }, '')).toBe(false);
	});
});
