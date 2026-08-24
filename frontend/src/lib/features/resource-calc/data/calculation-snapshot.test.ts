import { beforeEach, describe, expect, it, vi } from 'vitest';

const { peopleFor, operationsFor, peopleList, getBalance, getActive, getShelter } = vi.hoisted(
	() => ({
		peopleFor: vi.fn(),
		operationsFor: vi.fn(),
		peopleList: vi.fn(),
		getBalance: vi.fn(),
		getActive: vi.fn(),
		getShelter: vi.fn()
	})
);

vi.mock('$lib/features/people', () => ({
	peopleRepository: (code: string) => {
		peopleFor(code);
		return { listEvacuees: peopleList };
	}
}));

vi.mock('$lib/features/operations', () => ({
	operationsRepository: (code: string) => {
		operationsFor(code);
		return { getBalance };
	}
}));

vi.mock('$lib/features/shelters', () => ({
	sheltersRepository: () => ({ getShelter })
}));

vi.mock('$lib/features/sop-ratios', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/features/sop-ratios')>();
	return { ...original, getActiveSopProfile: getActive };
});

import { SOP_RATIO_KEYS, type SopRatioKey } from '$lib/features/sop-ratios';
import { loadCalculationSnapshot } from './calculation-snapshot';

const ratios = Object.fromEntries(SOP_RATIO_KEYS.map((key) => [key, '10'])) as Record<
	SopRatioKey,
	string
>;

beforeEach(() => {
	vi.clearAllMocks();
	peopleList.mockResolvedValue([{ current_stay: { status: 'active' } }]);
	getBalance.mockResolvedValue(new Map([['item:water', '1000']]));
	getActive.mockResolvedValue({
		_id: 'sop_profile:master',
		type: 'sop_profile',
		version: 3,
		ratios
	});
	getShelter.mockResolvedValue({
		area_m2: 1000,
		facilities: {
			water_points: 1,
			showers: 1,
			toilets_female: 1,
			toilets_male: 1
		}
	});
});

describe('loadCalculationSnapshot', () => {
	it('binds people, stock, SOP, and facilities to the requested shelter', async () => {
		const snapshot = await loadCalculationSnapshot('SH009');
		expect(peopleFor).toHaveBeenCalledWith('SH009');
		expect(operationsFor).toHaveBeenCalledWith('SH009');
		expect(getActive).toHaveBeenCalledWith('SH009');
		expect(getShelter).toHaveBeenCalledWith('SH009');
		expect(snapshot.shelter_code).toBe('SH009');
	});
});
