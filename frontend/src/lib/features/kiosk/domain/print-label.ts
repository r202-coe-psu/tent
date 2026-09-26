/**
 * Physical print settings for the kiosk report-in label (Xprinter XP-365B, 203 dpi TSPL).
 * KIOSK_LABEL_MM is the single source of truth for the label size: `scanner_client/setup_printer.sh`
 * must default `--label` to the same value so CSS `@page` and the CUPS `PageSize` agree.
 */
export const KIOSK_PRINT_DPI = 203;
export const KIOSK_LABEL_MM = { width: 80, height: 60 } as const;
export const KIOSK_LABEL_MAX_WIDTH_MM = 82;
export const KIOSK_LABEL_PADDING_MM = 2;
/** Extra right padding: the XP-365B clips the right edge of an 80 mm label. */
export const KIOSK_LABEL_RIGHT_SAFE_MM = 4;
/** Shifts the whole label content left to offset the XP-365B printing right of the label centre. */
export const KIOSK_LABEL_SHIFT_LEFT_MM = 4;
/** Space between the QR and the text. */
export const KIOSK_LABEL_GAP_MM = 2;
/** Height kept under the QR for caption + 2-line name + shelter. */
export const KIOSK_LABEL_TEXT_MM = 20;
export const KIOSK_QR_MIN_MM = 20;
export const KIOSK_QR_MARGIN_MODULES = 2;
export const KIOSK_QR_QUIET_ZONE_MODULES = 4;
/** Caps QR modules at 10 printer dots each for crisp thermal output. */
export const KIOSK_QR_MAX_DOTS_PER_MODULE = 10;
export const KIOSK_QR_COLOR = { dark: '#000000', light: '#FFFFFF' } as const;

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

/** Largest square (mm) the QR image may occupy above the label text. */
export function kioskQrBoxMm(): number {
	const innerWidth = KIOSK_LABEL_MM.width - KIOSK_LABEL_PADDING_MM * 2 - KIOSK_LABEL_RIGHT_SAFE_MM;
	const innerHeight = KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2;
	return Math.min(innerWidth, innerHeight - KIOSK_LABEL_GAP_MM - KIOSK_LABEL_TEXT_MM);
}

/**
 * Size a QR (moduleCount = modules per side, e.g. 29 for version 3) so every module is a whole
 * number of printer dots (at most KIOSK_QR_MAX_DOTS_PER_MODULE) and it fits the QR box.
 */
export function kioskQrPrintSize(moduleCount: number): KioskQrPrintSize {
	const paddingDots = mmToDots(KIOSK_LABEL_PADDING_MM);
	let size: KioskQrPrintSize | undefined;
	// Widen the in-image margin until image margin + label padding reach the 4-module quiet zone.
	for (let margin = KIOSK_QR_MARGIN_MODULES; margin <= KIOSK_QR_QUIET_ZONE_MODULES; margin++) {
		const totalModules = moduleCount + margin * 2;
		const maxDotsToFit = Math.floor(mmToDots(kioskQrBoxMm()) / totalModules);
		// Largest whole-dot module that fits the box, capped so the text column keeps the rest.
		const dotsPerModule = Math.max(1, Math.min(KIOSK_QR_MAX_DOTS_PER_MODULE, maxDotsToFit));
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
