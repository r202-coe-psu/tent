import { parkingPopupWords, vehicleCapacityValue, vehicleLabel } from '$lib/constants/i18n';
import type { ParkingMapPoint } from '../domain/parking';

/**
 * Popup body for a parking pin, built from DOM nodes: the name, shelter name and note are staff
 * free text and must never be parsed as HTML (CR-253 FR-32).
 */
export function parkingPopupContent(point: ParkingMapPoint, lang?: string): HTMLElement {
	const words = parkingPopupWords(lang);
	const root = document.createElement('div');
	root.dataset.testid = `parking-popup-${point.id}`;
	root.style.cssText = 'font-size:0.75rem;line-height:1.4;width:260px;max-width:100%;';

	const el = (css: string, text?: string) => {
		const node = document.createElement('div');
		node.style.cssText = css;
		if (text != null) node.textContent = text;
		return node;
	};

	const header = el('display:flex;justify-content:space-between;align-items:flex-start;gap:8px;');
	const title = el('min-width:0;');
	title.append(
		el('font-size:0.875rem;font-weight:700;color:#0f172a;', point.name),
		el('color:var(--primary,#124481);font-weight:600;margin-top:2px;', point.shelterName)
	);
	header.append(title);

	const vehicles = point.vehicles ?? [];
	root.append(header);

	if (point.note) root.append(el('color:#475569;margin-top:6px;', point.note));

	if (vehicles.length > 0) {
		const table = el('border-top:1px solid #e2e8f0;margin-top:8px;padding-top:8px;');
		const line = (left: string, right: string, css: string, rightCss: string) => {
			const row = el(`display:flex;justify-content:space-between;gap:12px;${css}`);
			row.append(el('', left), el(`text-align:right;white-space:nowrap;${rightCss}`, right));
			table.append(row);
		};
		line(words.typeColumn, words.capacityColumn, 'color:#64748b;', '');
		for (const v of vehicles) {
			line(
				vehicleLabel(v.type, lang),
				vehicleCapacityValue(v.type, v.max_capacity, lang),
				'color:#334155;margin-top:6px;',
				'font-weight:700;color:#0f172a;'
			);
		}
		root.append(table);
	}
	return root;
}
