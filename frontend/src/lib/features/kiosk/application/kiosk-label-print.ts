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
	/** Intake stations passed: this many checklist boxes are ticked. */
	checkedCount?: number;
};

/** QR payload → data URL sized for the label (module-count based), in the kiosk print colour. */
export async function prepareKioskQrImage(qrPayload: string): Promise<KioskQrImage> {
	const size = kioskQrPrintSize(await qrModuleCount(qrPayload));
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
	const image = await prepareKioskQrImage(qrPayload);
	return renderKioskLabelPng({ ...label, qrSrc: image.src });
}

/**
 * Render each label to a PNG (in order) and send them to the kiosk printer. `fallbackPrint` runs
 * only when no scanner client answered (dev browser / browser print mode).
 */
export function printKioskQrLabels(
	labels: readonly KioskQrLabel[],
	fallbackPrint: () => void | Promise<void>
): Promise<KioskPrintFlowResult> {
	return runKioskPrintFlow({
		renderLabels: () => Promise.all(labels.map((label) => renderKioskLabelPng(label))),
		printLabels: printKioskLabels,
		fallbackPrint
	});
}
