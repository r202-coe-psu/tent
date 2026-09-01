import { describe, expect, it } from 'vitest';
import type { ScenarioComparisonRow } from './scenario.schema';
import {
	scenarioDeltaLabel,
	scenarioAvailabilityLabel,
	scenarioGapLabel,
	scenarioKindLabel,
	formatScenarioQuantity,
	scenarioRequirementLabel,
	scenarioStockBalanceLabel,
	scenarioStockBalanceState
} from './scenario-display';

const row = (overrides: Partial<ScenarioComparisonRow> = {}): ScenarioComparisonRow => ({
	key: 'water_l_per_person_day',
	kind: 'multiply',
	current_ratio: '10',
	scenario_ratio: '15',
	ratio_overridden: true,
	current_daily_need: '5000',
	scenario_daily_need: '30000',
	current_horizon_need: '70000',
	scenario_horizon_need: '420000',
	have: '1000',
	current_horizon_gap: '69000',
	scenario_horizon_gap: '419000',
	need_delta: '350000',
	gap_delta: '350000',
	current_data_status: 'complete',
	scenario_data_status: 'complete',
	...overrides
});

describe('scenario comparison presentation', () => {
	it('formats large qty_str values without Number precision loss', () => {
		expect(formatScenarioQuantity('9007199254740993')).toBe('9,007,199,254,740,993');
		expect(formatScenarioQuantity('1.005')).toBe('1.01');
	});

	it('labels cumulative resources using the selected horizon', () => {
		expect(scenarioKindLabel(row(), 14)).toBe('14 วัน');
		expect(scenarioRequirementLabel(row(), 'scenario')).toContain('420,000');
		expect(scenarioGapLabel(row(), 'current')).toContain('69,000');
	});

	it('labels divide resources as concurrent capacity', () => {
		expect(scenarioKindLabel(row({ kind: 'divide' }), 14)).toBe('พร้อมกัน');
	});

	it('does not present threshold nulls as missing data', () => {
		const threshold = row({
			kind: 'threshold',
			current_horizon_need: null,
			scenario_horizon_need: null,
			current_horizon_gap: null,
			scenario_horizon_gap: null,
			need_delta: null,
			gap_delta: null
		});
		expect(scenarioRequirementLabel(threshold, 'scenario')).toBe('ไม่สะสม');
		expect(scenarioGapLabel(threshold, 'scenario')).toBe('ไม่ใช้ Gap');
		expect(scenarioDeltaLabel(threshold, 'gap_delta')).toBe('—');
		expect(scenarioStockBalanceLabel(threshold, 'scenario')).toBe('ไม่ใช้ Stock');
	});

	it.each([
		['69000', 'shortage', 'ขาด 69,000'],
		['0', 'balanced', 'พอดี'],
		['-2500', 'surplus', 'เหลือ 2,500']
	] as const)('presents stock balance %s as %s', (gap, state, label) => {
		const value = row({ scenario_horizon_gap: gap });
		expect(scenarioStockBalanceState(value, 'scenario')).toBe(state);
		expect(scenarioStockBalanceLabel(value, 'scenario')).toBe(label);
	});

	it('distinguishes unsynced stock from a numeric zero', () => {
		const unsynced = row({ have: null, current_horizon_gap: null, scenario_horizon_gap: null });
		expect(scenarioAvailabilityLabel(unsynced)).toBe('รอข้อมูล Stock');
		expect(scenarioStockBalanceLabel(unsynced, 'current')).toBe('รอข้อมูล Stock');
	});
});
