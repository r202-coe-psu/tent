/**
 * Physical print settings for the kiosk report-in label (Xprinter XP-365B, 203 dpi TSPL).
 * KIOSK_LABEL_MM is the single source of truth for the label size: `scanner_client/setup_printer.sh`
 * must default `--label` to the same value so CSS `@page` and the CUPS `PageSize` agree.
 */
export const KIOSK_PRINT_DPI = 203;
export const KIOSK_LABEL_MM = { width: 60, height: 60 } as const;
export const KIOSK_LABEL_MAX_WIDTH_MM = 82;
export const KIOSK_LABEL_PADDING_MM = 2;
/** Space between the QR and the text. */
export const KIOSK_LABEL_GAP_MM = 2;
/** Side layout: minimum width of the text column right of the QR (brand, name, shelter). */
export const KIOSK_LABEL_SIDE_TEXT_MM = 28;
/** Stacked layout: height kept under the QR for brand + 2-line name + shelter. */
export const KIOSK_LABEL_TEXT_MM = 20;
export const KIOSK_QR_MIN_MM = 20;
export const KIOSK_QR_MARGIN_MODULES = 2;
export const KIOSK_QR_QUIET_ZONE_MODULES = 4;
/** Modules above 1 mm (8 dots) add no scan margin, so bigger labels do not grow the QR further. */
export const KIOSK_QR_MAX_DOTS_PER_MODULE = 8;
export const KIOSK_QR_COLOR = { dark: '#000000', light: '#FFFFFF' } as const;

/** 'side' = QR at the left edge, text beside it; 'stacked' = QR on top, text below. */
export type KioskLabelLayout = 'stacked' | 'side';
export const KIOSK_LABEL_LAYOUT: KioskLabelLayout = 'side';

const MM_PER_INCH = 25.4;
const QUIET_ZONE_TOLERANCE_MODULES = 0.05;

export type KioskQrPrintSize = {
	/** Source image width in px; printed 1 px = 1 dot so modules stay a whole number of dots. */
	widthPx: number;
	/** Printed image size (including the margin modules) in mm. */
	sizeMm: number;
	margin: number;
	dotsPerModule: number;
};

export function mmToDots(mm: number): number {
	return (mm / MM_PER_INCH) * KIOSK_PRINT_DPI;
}

export function dotsToMm(dots: number): number {
	return (dots / KIOSK_PRINT_DPI) * MM_PER_INCH;
}

/** Largest square (mm) the QR image may occupy on the label for the current layout. */
export function kioskQrBoxMm(): number {
	const innerWidth = KIOSK_LABEL_MM.width - KIOSK_LABEL_PADDING_MM * 2;
	const innerHeight = KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2;
	return KIOSK_LABEL_LAYOUT === 'stacked'
		? Math.min(innerWidth, innerHeight - KIOSK_LABEL_GAP_MM - KIOSK_LABEL_TEXT_MM)
		: Math.min(innerHeight, innerWidth - KIOSK_LABEL_GAP_MM - KIOSK_LABEL_SIDE_TEXT_MM);
}

/**
 * Size a QR (moduleCount = modules per side, e.g. 29 for version 3) so every module is a whole
 * number of printer dots, the visible code is at least KIOSK_QR_MIN_MM, and it fits the QR box.
 */
export function kioskQrPrintSize(moduleCount: number): KioskQrPrintSize {
	const minDotsForSize = Math.ceil(mmToDots(KIOSK_QR_MIN_MM) / moduleCount);
	const paddingDots = mmToDots(KIOSK_LABEL_PADDING_MM);
	let size: KioskQrPrintSize | undefined;
	// Widen the in-image margin until image margin + label padding reach the 4-module quiet zone.
	for (let margin = KIOSK_QR_MARGIN_MODULES; margin <= KIOSK_QR_QUIET_ZONE_MODULES; margin++) {
		const totalModules = moduleCount + margin * 2;
		const maxDotsToFit = Math.floor(mmToDots(kioskQrBoxMm()) / totalModules);
		// Largest whole-dot module that fits, capped; never below the 20 mm minimum when it fits.
		const dotsPerModule = Math.max(
			1,
			Math.min(Math.max(KIOSK_QR_MAX_DOTS_PER_MODULE, minDotsForSize), maxDotsToFit)
		);
		const widthPx = totalModules * dotsPerModule;
		size = { widthPx, sizeMm: dotsToMm(widthPx), margin, dotsPerModule };
		// 2 mm padding is 15.98 dots, i.e. 1.998 modules at 8 dots — treat that as 2, not a shortfall.
		const quietZone = margin + paddingDots / dotsPerModule;
		if (quietZone >= KIOSK_QR_QUIET_ZONE_MODULES - QUIET_ZONE_TOLERANCE_MODULES) break;
	}
	return size as KioskQrPrintSize;
}

export function kioskLabelPageCss(): string {
	return `@page{size:${KIOSK_LABEL_MM.width}mm ${KIOSK_LABEL_MM.height}mm;margin:0}`;
}
