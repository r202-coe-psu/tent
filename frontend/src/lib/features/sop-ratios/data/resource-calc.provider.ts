/**
 * Provisional data source for the resource-calc dashboard (T-32).
 *
 * ⚠️ PLACEHOLDER PENDING T-31 (FR-45). The real daily calc engine is not built
 * yet, so this returns a deterministic representative snapshot so the dashboard
 * UI is reviewable end-to-end. When T-31 lands, replace the body of
 * `loadResourceCalc` with a read of the live read-model (occupancy aggregate ×
 * effective SOP ratio vs stock_balance) — the return type is the stable seam.
 */

import { computeGap, type GapRow, type ResourceCalcSnapshot } from '../domain/resource-calc';
import type { TrendSeries } from '../domain/trend';

/** Last `n` calendar dates ending today, as `YYYY-MM-DD` (local). */
function lastNDates(n: number): string[] {
	const today = new Date();
	return Array.from({ length: n }, (_, i) => {
		const d = new Date(today);
		d.setDate(today.getDate() - (n - 1 - i));
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	});
}

function gapRow(
	input: Omit<GapRow, 'gap' | 'provenance'> & { occupancy: number; asOf: string }
): GapRow {
	const { occupancy, asOf, ...rest } = input;
	return {
		...rest,
		gap: computeGap(rest.need, rest.have),
		provenance: {
			occupancy,
			ratio: occupancy > 0 ? Math.round((rest.need / occupancy) * 100) / 100 : 0,
			stock: rest.have,
			as_of: asOf
		}
	};
}

/**
 * Returns the current resource-shortage snapshot for a shelter.
 * Provisional: data is illustrative, not read from CouchDB (see file header).
 */
export async function loadResourceCalc(shelterCode: string): Promise<ResourceCalcSnapshot> {
	const asOf = new Date().toISOString();
	const occupancy = 320;

	const rows: GapRow[] = [
		gapRow({
			item_id: 'water',
			label: 'น้ำดื่ม',
			category: 'food',
			unit: 'ขวด',
			need: 960,
			have: 410,
			ratio_source: 'master',
			occupancy,
			asOf
		}),
		gapRow({
			item_id: 'rice',
			label: 'ข้าวสาร',
			category: 'food',
			unit: 'กก.',
			need: 240,
			have: 180,
			ratio_source: 'override',
			occupancy,
			asOf
		}),
		gapRow({
			item_id: 'cooked_meal',
			label: 'อาหารปรุงสุก',
			category: 'food',
			unit: 'กล่อง',
			need: 960,
			have: 940,
			ratio_source: 'master',
			occupancy,
			asOf
		}),
		gapRow({
			item_id: 'sanitary_pad',
			label: 'ผ้าอนามัย',
			category: 'supply',
			unit: 'แพ็ค',
			need: 120,
			have: 38,
			ratio_source: 'master',
			occupancy,
			asOf
		}),
		gapRow({
			item_id: 'blanket',
			label: 'ผ้าห่ม',
			category: 'supply',
			unit: 'ผืน',
			need: 320,
			have: 260,
			ratio_source: 'override',
			occupancy,
			asOf
		}),
		gapRow({
			item_id: 'first_aid',
			label: 'ชุดปฐมพยาบาล',
			category: 'supply',
			unit: 'ชุด',
			need: 16,
			have: 16,
			ratio_source: 'master',
			occupancy,
			asOf
		}),
		gapRow({
			item_id: 'kitchen_vol',
			label: 'อาสาประจำครัว',
			category: 'volunteer',
			unit: 'คน',
			need: 24,
			have: 9,
			ratio_source: 'master',
			occupancy,
			asOf
		}),
		gapRow({
			item_id: 'medic_vol',
			label: 'อาสาพยาบาล',
			category: 'volunteer',
			unit: 'คน',
			need: 12,
			have: 10,
			ratio_source: 'override',
			occupancy,
			asOf
		})
	];

	const dates = lastNDates(7);
	const series = (key: string, label: string, gaps: number[]): TrendSeries => ({
		key,
		label,
		points: dates.map((date, i) => ({ date, gap: gaps[i] }))
	});

	const trend: TrendSeries[] = [
		series('food', 'อาหาร', [380, 520, 470, 610, 540, 560, 590]),
		series('supply', 'ของใช้', [60, 95, 120, 110, 140, 150, 142]),
		series('volunteer', 'อาสา', [10, 14, 18, 20, 17, 19, 17])
	];

	return { shelter_code: shelterCode, as_of: asOf, occupancy, rows, trend };
}
