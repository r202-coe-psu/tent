/**
 * Physical size of the kiosk report-in label (Xprinter XP-365B, 203 dpi TSPL), shared by the kiosk
 * renderer and the print server's PNG validation.
 * KIOSK_LABEL_MM is the single source of truth for the label size: `kiosk/setup_printer.sh`
 * must default `--label` to the same value so CSS `@page` and the CUPS `PageSize` agree.
 */
export const KIOSK_PRINT_DPI = 203;
export const KIOSK_LABEL_MM = { width: 80, height: 60 } as const;

const MM_PER_INCH = 25.4;

export function mmToDots(mm: number): number {
	return (mm / MM_PER_INCH) * KIOSK_PRINT_DPI;
}

/**
 * Whole-dot canvas size of one label (80×60 mm → 639×479 at 203 dpi). Rounded down: CUPS
 * `imagetoraster` splits an image even one dot taller than the page (60 mm = 479.5 dots) across
 * two labels, cutting the QR in half.
 */
export function kioskLabelDots(): { width: number; height: number } {
	return {
		width: Math.floor(mmToDots(KIOSK_LABEL_MM.width)),
		height: Math.floor(mmToDots(KIOSK_LABEL_MM.height))
	};
}
