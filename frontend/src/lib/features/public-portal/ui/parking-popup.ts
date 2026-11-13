import { vehicleCapacityText, vehicleLabel } from '$lib/constants/i18n';
import type { ParkingMapPoint } from '../domain/parking';

/**
 * Popup body for a parking pin, built from DOM nodes: the note is staff free text and must never
 * be parsed as HTML (CR-253 FR-32).
 */
export function parkingPopupContent(point: ParkingMapPoint, lang?: string): HTMLElement {
	const root = document.createElement('div');
	root.dataset.testid = `parking-popup-${point.id}`;
	root.style.cssText = 'font-size:0.75rem;line-height:1.4;max-width:220px;';

	const row = (text: string, css: string) => {
		const el = document.createElement('div');
		el.style.cssText = css;
		el.textContent = text;
		root.append(el);
	};

	row(point.name, 'font-weight:700;color:#0f172a;');
	if (point.note) row(point.note, 'color:#475569;margin-top:2px;');
	for (const v of point.vehicles ?? []) {
		row(
			`${vehicleLabel(v.type, lang)} · ${vehicleCapacityText(v.type, v.max_capacity, lang)}`,
			'color:#334155;margin-top:2px;'
		);
	}
	return root;
}
