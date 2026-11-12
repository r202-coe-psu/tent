import type { VulnerabilityMarker } from '$lib/utils/vulnerability-marker';
import type { LanguageCode } from '$lib/stores/language.svelte';
import { generateQrDataUrl, qrModuleCount } from '$lib/utils/qrcode';
import { printKioskLabels } from '../data/kiosk-print.api';
import { KIOSK_QR_COLOR, kioskQrPrintSize } from '../domain/print-label';
import { renderKioskLabelPng, type KioskLabelContent } from './kiosk-label-image';
import { runKioskPrintFlow, type KioskPrintFlowResult } from './kiosk-print-flow';

export type KioskQrImage = { src: string; sizeMm: number };

export type KioskQrLabel = {
	qrSrc: string;
	name: string;
	zone?: string | null;
	/** Emergency contact phone printed under the zone; none leaves no row. */
	emergencyPhone?: string | null;
	/** Intake stations passed: this many checklist boxes are ticked. */
	checkedCount?: number;
	/** Vulnerability level printed as a marker row above the name; none leaves no row. */
	marker?: VulnerabilityMarker | null;
};

/**
 * QR payload → data URL sized for the label (module-count based), in the kiosk print colour. Pass
 * the label's `marker`: the level band at the left edge leaves a smaller QR.
 */
export async function prepareKioskQrImage(
	qrPayload: string,
	marker?: VulnerabilityMarker | null
): Promise<KioskQrImage> {
	const size = kioskQrPrintSize(await qrModuleCount(qrPayload), marker);
	const src = await generateQrDataUrl(qrPayload, {
		width: size.widthPx,
		margin: size.margin,
		color: KIOSK_QR_COLOR
	});
	if (!src) throw new Error('QR render returned empty');
	return { src, sizeMm: size.sizeMm };
}

/**
 * One label as base64 PNG for a QR payload: the same 80×60 mm image the kiosk sends to its
 * printer, for staff stations that print the label themselves.
 */
export async function renderKioskQrLabelPng(
	qrPayload: string,
	label: Omit<KioskLabelContent, 'qrSrc'>
): Promise<string> {
	const image = await prepareKioskQrImage(qrPayload, label.marker);
	return renderKioskLabelPng({ ...label, qrSrc: image.src });
}

/**
 * Render each label to a PNG (in order) and send them to the kiosk printer. `fallbackPrint` runs
 * only when no scanner client answered (dev browser / browser print mode). `language` words the
 * error message shown on screen; the labels themselves stay Thai.
 */
export function printKioskQrLabels(
	labels: readonly KioskQrLabel[],
	fallbackPrint: () => void | Promise<void>,
	language?: LanguageCode
): Promise<KioskPrintFlowResult> {
	return runKioskPrintFlow({
		renderLabels: () => Promise.all(labels.map((label) => renderKioskLabelPng(label))),
		printLabels: printKioskLabels,
		fallbackPrint,
		language
	});
}
