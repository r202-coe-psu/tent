import { describe, expect, it } from 'vitest';
import { SOP_RATIO_KEYS, SOP_RATIO_KIND } from '$lib/features/sop-ratios/domain/sop-ratio';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';
import { calculateResources } from '../domain/calc.formula';
import {
	DailyCalcReadError,
	canonicalDailyCalcDocSchema,
	parseDailyCalcRecord
} from './daily-calc.validation';
import { resolveHave } from './have-map';

const AS_OF = '2026-07-08T09:00:00.000Z';
const shelter = {
	area_m2: 800,
	facilities: { water_points: 6, showers: 8, toilets_female: 4, toilets_male: 4 }
};
const stock = new Map([['item:water', '400']]);

function makeRecord() {
	const resources = SOP_RATIO_KEYS.map((key) => ({
		key,
		kind: SOP_RATIO_KIND[key],
		ratio: validRatios[key],
		have: resolveHave(key, { stock, shelter })
	}));
	const results = calculateResources({ occupancy: 10, as_of: AS_OF, resources });
	return {
		_id: 'daily_calc:2026-07-08',
		type: 'daily_calc' as const,
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: AS_OF,
		updated_at: AS_OF,
		created_by: 'seed',
		formula_v: '2.0.0',
		sop_profile_version: 1,
		ratio_source: 'master' as const,
		sop_override_id: null,
		sop_override_version: null,
		ratio_snapshot: { ...validRatios },
		occupancy_snapshot: 10,
		as_of: AS_OF,
		stock_snapshot: Object.fromEntries(resources.map((resource) => [resource.key, resource.have])),
		results
	};
}

describe('persisted daily_calc validation', () => {
	it('accepts a canonical v2 record with exactly 20 keys', () => {
		const record = makeRecord();
		expect(parseDailyCalcRecord(record)._id).toBe(record._id);
		expect(record.results).toHaveLength(20);
	});

	it('rejects an unsupported schema before parsing the v2 body', () => {
		const record = { ...makeRecord(), schema_v: 1 };
		expect(() => parseDailyCalcRecord(record)).toThrowError(DailyCalcReadError);
		try {
			parseDailyCalcRecord(record);
		} catch (error) {
			expect(error).toMatchObject({ kind: 'unsupported_schema', documentId: record._id });
		}
	});

	it('rejects a non-daily document at the envelope boundary', () => {
		const record = { ...makeRecord(), type: 'audit' };
		expect(() => parseDailyCalcRecord(record)).toThrowError(
			expect.objectContaining({ kind: 'wrong_type', documentId: record._id })
		);
	});

	it('rejects an incomplete canonical result set at the persisted boundary', () => {
		const record = makeRecord();
		const incomplete = { ...record, results: record.results.slice(0, -1) };
		expect(canonicalDailyCalcDocSchema.safeParse(incomplete).success).toBe(false);
		expect(() => parseDailyCalcRecord(incomplete)).toThrowError(/invalid_schema/);
	});

	it('rejects an unknown ratio key even when the total row count remains 20', () => {
		const record = makeRecord();
		const unknownKey = 'rice_g_per_person_meal';
		const ratioSnapshot = Object.fromEntries(
			Object.entries(record.ratio_snapshot).filter(([key]) => key !== 'water_l_per_person_day')
		);
		ratioSnapshot[unknownKey] = '1';
		const stockSnapshot = Object.fromEntries(
			Object.entries(record.stock_snapshot).filter(([key]) => key !== 'water_l_per_person_day')
		);
		stockSnapshot[unknownKey] = null;
		const results = record.results.map((result) =>
			result.key === 'water_l_per_person_day'
				? { ...result, key: unknownKey, ratio: '1', have: null }
				: result
		);
		const invalid = {
			...record,
			ratio_snapshot: ratioSnapshot,
			stock_snapshot: stockSnapshot,
			results
		};
		expect(() => parseDailyCalcRecord(invalid)).toThrowError(/invalid_schema/);
	});

	it('rejects semantically inconsistent persisted gap values', () => {
		const record = makeRecord();
		const invalid = {
			...record,
			results: record.results.map((result) =>
				result.key === 'water_l_per_person_day' ? { ...result, gap: '999' } : result
			)
		};
		expect(() => parseDailyCalcRecord(invalid)).toThrowError(/invalid_invariant/);
	});

	it('rejects a positive deficit that is mislabeled as ok', () => {
		const record = makeRecord();
		const invalid = {
			...record,
			results: record.results.map((result) =>
				result.key === 'people_per_toilet_female'
					? {
							...result,
							have: '0',
							gap: result.need,
							status: 'ok' as const,
							data_status: 'complete' as const
						}
					: result
			),
			stock_snapshot: { ...record.stock_snapshot, people_per_toilet_female: '0' }
		};

		expect(() => parseDailyCalcRecord(invalid)).toThrowError(/invalid_invariant/);
	});

	it.each([
		['an unmapped source', 'people_per_volunteer', '2'],
		['a different water balance', 'drinking_water_l_per_person_day', '399'],
		['a different area value', 'm2_per_person_total', '799']
	] as const)('rejects %s in the frozen CR-042 have snapshot', (_case, key, have) => {
		const record = makeRecord();
		const invalid = {
			...record,
			stock_snapshot: { ...record.stock_snapshot, [key]: have },
			results: record.results.map((result) => (result.key === key ? { ...result, have } : result))
		};

		expect(() => parseDailyCalcRecord(invalid)).toThrowError(/invalid_schema/);
	});
});
