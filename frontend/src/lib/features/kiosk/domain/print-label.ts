/**
 * Physical print settings for the kiosk report-in label (Xprinter XP-365B, 203 dpi TSPL).
 * KIOSK_LABEL_MM is the single source of truth for the label size: `scanner_client/setup_printer.sh`
 * must default `--label` to the same value so CSS `@page` and the CUPS `PageSize` agree.
 */
export const KIOSK_PRINT_DPI = 203;
export const KIOSK_LABEL_MM = { width: 80, height: 60 } as const;
export const KIOSK_LABEL_MAX_WIDTH_MM = 82;
export const KIOSK_LABEL_PADDING_MM = 2;
/**
 * Horizontal nudge for the whole label content (positive = right). 0 centres it on the label;
 * tune on the real printer if the XP-365B feeds off-centre.
 */
export const KIOSK_LABEL_OFFSET_X_MM = 0;
/** Space on each side of the divider line between the text column and the QR. */
export const KIOSK_LABEL_GAP_MM = 2;
/** Vertical divider between the text column and the QR (the ID card's panel border). */
export const KIOSK_LABEL_DIVIDER_MM = 0.25;
/** Narrowest text column the QR may leave: a 3-line name and the wrapped checklist need it. */
export const KIOSK_LABEL_TEXT_MIN_WIDTH_MM = 37;
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

/** Largest square (mm) the QR image may occupy on the right of the text column. */
export function kioskQrBoxMm(): number {
	const innerWidth = KIOSK_LABEL_MM.width - KIOSK_LABEL_PADDING_MM * 2;
	const innerHeight = KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2;
	const besideText =
		innerWidth - KIOSK_LABEL_TEXT_MIN_WIDTH_MM - KIOSK_LABEL_GAP_MM * 2 - KIOSK_LABEL_DIVIDER_MM;
	return Math.min(innerHeight, besideText);
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

/**
 * Label text styles (pt + unitless line height), shared by the print CSS and the PNG renderer.
 * Mirrors the staff ID card (`QrIdCard`): bold name, tracked mono phone, checklist at the bottom.
 */
export const KIOSK_LABEL_TEXT = {
	name: { pt: 16, lineHeight: 1.3, weight: 700, maxLines: 3 },
	phone: { pt: 12, lineHeight: 1.3, weight: 700, letterSpacingEm: 0.1 },
	checklist: { pt: 10, lineHeight: 1.3, weight: 500 }
} as const;
/** Space between the name and the phone line. */
export const KIOSK_LABEL_TEXT_ROW_GAP_MM = 0.5;
/** Staff ID card checklist, ticked by hand at each station. */
export const KIOSK_LABEL_CHECKLIST = ['เช็คอิน', 'คัดกรอง', 'ที่พัก'] as const;
export const KIOSK_LABEL_CHECKBOX = {
	sizeMm: 3.5,
	borderMm: 0.3,
	/** Box → its text. */
	textGapMm: 1.5,
	/** Between checklist items on one row. */
	itemGapMm: 4,
	/** Between wrapped checklist rows. */
	rowGapMm: 1.5
} as const;

const PT_PER_INCH = 72;

export function ptToDots(pt: number): number {
	return (pt / PT_PER_INCH) * KIOSK_PRINT_DPI;
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

/**
 * Greedy line wrap for label text. Thai has no spaces, so `segments` should come from a word
 * segmenter; a segment wider than the line is split into graphemes. Overflow past `maxLines`
 * ends the last line with an ellipsis (matching CSS `line-clamp`).
 */
export function wrapLabelText(
	segments: readonly string[],
	maxWidth: number,
	measure: (text: string) => number,
	maxLines: number,
	splitGraphemes: (text: string) => string[] = (text) => Array.from(text)
): string[] {
	const pieces = segments.flatMap((segment) =>
		measure(segment.trim()) > maxWidth ? splitGraphemes(segment) : [segment]
	);
	const lines: string[] = [];
	let current = '';
	for (const piece of pieces) {
		if (current === '' || measure(current + piece) <= maxWidth) {
			current = (current + piece).trimStart();
			continue;
		}
		lines.push(current.trimEnd());
		current = piece.trimStart();
	}
	if (current) lines.push(current.trimEnd());
	if (lines.length <= maxLines) return lines;

	const kept = lines.slice(0, maxLines);
	const graphemes = splitGraphemes(kept[maxLines - 1] ?? '');
	const withEllipsis = () => `${graphemes.join('').trimEnd()}…`;
	while (graphemes.length > 0 && measure(withEllipsis()) > maxWidth) graphemes.pop();
	kept[maxLines - 1] = withEllipsis();
	return kept;
}

export type KioskLabelLayout = {
	qr: { x: number; y: number };
	divider: { x: number; y: number; width: number; height: number };
	text: { x: number; y: number; width: number; bottom: number };
};

/**
 * Whole-dot geometry of the ID-card label: text column on the left, a divider line, and the QR
 * (`qrPx` square, 1 px = 1 dot) right-aligned and centred vertically, as in `QrIdCard`.
 */
export function kioskLabelLayout(qrPx: number): KioskLabelLayout {
	const { width, height } = kioskLabelDots();
	const padding = Math.round(mmToDots(KIOSK_LABEL_PADDING_MM));
	const gap = Math.round(mmToDots(KIOSK_LABEL_GAP_MM));
	const offset = Math.round(mmToDots(KIOSK_LABEL_OFFSET_X_MM));
	const dividerWidth = Math.max(1, Math.round(mmToDots(KIOSK_LABEL_DIVIDER_MM)));
	const qrX = width - padding - qrPx + offset;
	const dividerX = qrX - gap - dividerWidth;
	const textX = padding + offset;
	return {
		qr: { x: qrX, y: Math.round((height - qrPx) / 2) },
		divider: { x: dividerX, y: padding, width: dividerWidth, height: height - padding * 2 },
		text: { x: textX, y: padding, width: dividerX - gap - textX, bottom: height - padding }
	};
}

export type ChecklistPlacement = { text: string; x: number; width: number };

/**
 * Lay the checklist out like the card's `flex-wrap`: items left to right, wrapping to a new row
 * when the next one would cross `maxWidth`. `x` and `width` include the checkbox.
 */
export function layoutChecklist(
	items: readonly string[],
	maxWidth: number,
	measure: (text: string) => number,
	metrics: { boxSize: number; textGap: number; itemGap: number }
): ChecklistPlacement[][] {
	const rows: ChecklistPlacement[][] = [];
	let row: ChecklistPlacement[] = [];
	let x = 0;
	for (const text of items) {
		const width = metrics.boxSize + metrics.textGap + measure(text);
		const start = row.length === 0 ? 0 : x + metrics.itemGap;
		if (row.length > 0 && start + width > maxWidth) {
			rows.push(row);
			row = [{ text, x: 0, width }];
			x = width;
			continue;
		}
		row.push({ text, x: start, width });
		x = start + width;
	}
	if (row.length > 0) rows.push(row);
	return rows;
}
