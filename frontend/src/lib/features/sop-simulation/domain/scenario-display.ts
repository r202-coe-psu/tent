import Decimal from 'decimal.js';
import type { ScenarioComparisonRow } from './scenario.schema';

const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

export const formatScenarioQuantity = (value: string | null): string =>
	value === null ? 'ไม่มีข้อมูล' : number.format(Number(value));

export function scenarioRequirementLabel(
	row: ScenarioComparisonRow,
	side: 'current' | 'scenario'
): string {
	if (row.kind === 'threshold') return 'ไม่สะสม';
	return formatScenarioQuantity(
		side === 'current' ? row.current_horizon_need : row.scenario_horizon_need
	);
}

export function scenarioGapLabel(row: ScenarioComparisonRow, side: 'current' | 'scenario'): string {
	if (row.kind === 'threshold') return 'ไม่ใช้ Gap';
	return formatScenarioQuantity(
		side === 'current' ? row.current_horizon_gap : row.scenario_horizon_gap
	);
}

export type ScenarioStockBalanceState =
	'shortage' | 'surplus' | 'balanced' | 'missing' | 'not_applicable';

function gapFor(row: ScenarioComparisonRow, side: 'current' | 'scenario'): string | null {
	return side === 'current' ? row.current_horizon_gap : row.scenario_horizon_gap;
}

export function scenarioStockBalanceState(
	row: ScenarioComparisonRow,
	side: 'current' | 'scenario'
): ScenarioStockBalanceState {
	if (row.kind === 'threshold') return 'not_applicable';
	const gap = gapFor(row, side);
	if (gap === null) return 'missing';
	const decimal = new Decimal(gap);
	if (decimal.gt(0)) return 'shortage';
	if (decimal.lt(0)) return 'surplus';
	return 'balanced';
}

export function scenarioStockBalanceLabel(
	row: ScenarioComparisonRow,
	side: 'current' | 'scenario'
): string {
	const state = scenarioStockBalanceState(row, side);
	if (state === 'not_applicable') return 'ไม่ใช้ Stock';
	if (state === 'missing') return 'รอข้อมูล Stock';
	if (state === 'balanced') return 'พอดี';
	const gap = new Decimal(gapFor(row, side)!);
	return `${state === 'shortage' ? 'ขาด' : 'เหลือ'} ${formatScenarioQuantity(gap.abs().toString())}`;
}

export function scenarioAvailabilityLabel(row: ScenarioComparisonRow): string {
	if (row.have === null) return row.kind === 'threshold' ? 'ไม่มีข้อมูล' : 'รอข้อมูล Stock';
	return formatScenarioQuantity(row.have);
}

export function scenarioDeltaLabel(
	row: ScenarioComparisonRow,
	field: 'need_delta' | 'gap_delta'
): string {
	if (row.kind === 'threshold') return '—';
	return formatScenarioQuantity(row[field]);
}

export function scenarioKindLabel(row: ScenarioComparisonRow, days: number): string {
	if (row.kind === 'multiply') return `${days} วัน`;
	if (row.kind === 'divide') return 'พร้อมกัน';
	return 'ข้อกำหนด';
}
