/**
 * Physical print settings for the kiosk report-in label (Xprinter XP-365B, 203 dpi TSPL).
 * KIOSK_LABEL_MM is the single source of truth for the label size: `scanner_client/setup_printer.sh`
 * must default `--label` to the same value so CSS `@page` and the CUPS `PageSize` agree.
 */
export const KIOSK_PRINT_DPI = 203;
export const KIOSK_LABEL_MM = { width: 60, height: 40 } as const;
export const KIOSK_LABEL_MAX_WIDTH_MM = 82;
export const KIOSK_LABEL_PADDING_MM = 2;
export const KIOSK_QR_MIN_MM = 20;
export const KIOSK_QR_MARGIN_MODULES = 2;
export const KIOSK_QR_QUIET_ZONE_MODULES = 4;
export const KIOSK_QR_BASE_DOTS_PER_MODULE = 6;
export const KIOSK_QR_COLOR = { dark: '#000000', light: '#FFFFFF' } as const;

const MM_PER_INCH = 25.4;

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

/**
 * Size a QR (moduleCount = modules per side, e.g. 29 for version 3) so every module is a whole
 * number of printer dots, the visible code is at least KIOSK_QR_MIN_MM, and it fits the label.
 */
export function kioskQrPrintSize(moduleCount: number): KioskQrPrintSize {
	const minDotsForSize = Math.ceil(mmToDots(KIOSK_QR_MIN_MM) / moduleCount);
	const paddingDots = mmToDots(KIOSK_LABEL_PADDING_MM);
	let size: KioskQrPrintSize | undefined;
	// Widen the in-image margin until image margin + label padding reach the 4-module quiet zone.
	for (let margin = KIOSK_QR_MARGIN_MODULES; margin <= KIOSK_QR_QUIET_ZONE_MODULES; margin++) {
		const totalModules = moduleCount + margin * 2;
		const maxDotsToFit = Math.floor(
			mmToDots(KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2) / totalModules
		);
		const dotsPerModule = Math.max(
			1,
			Math.min(Math.max(KIOSK_QR_BASE_DOTS_PER_MODULE, minDotsForSize), maxDotsToFit)
		);
		const widthPx = totalModules * dotsPerModule;
		size = { widthPx, sizeMm: dotsToMm(widthPx), margin, dotsPerModule };
		if (margin + paddingDots / dotsPerModule >= KIOSK_QR_QUIET_ZONE_MODULES) break;
	}
	return size as KioskQrPrintSize;
}

export function kioskLabelPageCss(): string {
	return `@page{size:${KIOSK_LABEL_MM.width}mm ${KIOSK_LABEL_MM.height}mm;margin:0}`;
}
