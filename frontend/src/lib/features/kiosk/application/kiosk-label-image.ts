import {
	KIOSK_LABEL_CHECKBOX,
	KIOSK_LABEL_CHECKLIST,
	KIOSK_LABEL_LINK,
	KIOSK_LABEL_LINK_GAP_MM,
	KIOSK_LABEL_TEXT,
	KIOSK_LABEL_ZONE,
	kioskLabelDots,
	kioskLabelLayout,
	labelZoneLine,
	mmToDots,
	type LabelZoneLine,
	ptToDots,
	wrapLabelText
} from '../domain/print-label';

export type KioskLabelContent = {
	/** QR data URL rendered at 1 px per printer dot (see `kioskQrPrintSize`). */
	qrSrc: string;
	name: string;
	/** Current zone name; missing or null leaves a dotted rule to write the zone on. */
	zone?: string | null;
	checklist?: readonly string[];
	/** Intake stations passed: this many checklist boxes are ticked, top first. */
	checkedCount?: number;
};

/** Thermal heads print dots, not greys: anything darker than this becomes black. */
const INK_THRESHOLD = 160;
/** Matches the app's typography stack (`$lib/tokens/typography.ts`) so Thai glyphs render
 * instead of the generic sans-serif fallback's tofu boxes on a kiosk without a system Thai font. */
const FONT_FAMILY = "'IBM Plex Sans Thai', sans-serif";

function loadImage(src: string): Promise<HTMLImageElement> {
	const image = new Image();
	image.src = src;
	return image.decode().then(() => image);
}

function segmenter(granularity: 'word' | 'grapheme'): (text: string) => string[] {
	if (typeof Intl.Segmenter !== 'function') return (text) => Array.from(text);
	const instance = new Intl.Segmenter('th', { granularity });
	return (text) => Array.from(instance.segment(text), (part) => part.segment);
}

function binarize(context: CanvasRenderingContext2D, width: number, height: number): void {
	const image = context.getImageData(0, 0, width, height);
	const pixels = image.data;
	for (let index = 0; index < pixels.length; index += 4) {
		const luminance =
			pixels[index]! * 0.299 + pixels[index + 1]! * 0.587 + pixels[index + 2]! * 0.114;
		const value = luminance < INK_THRESHOLD ? 0 : 255;
		pixels[index] = value;
		pixels[index + 1] = value;
		pixels[index + 2] = value;
		pixels[index + 3] = 255;
	}
	context.putImageData(image, 0, 0);
}

/**
 * Draw one kiosk label (same layout as `QrIdCard`'s `label` variant) at printer resolution and
 * return it as base64 PNG for the scanner client's direct CUPS print.
 */
export async function renderKioskLabelPng(label: KioskLabelContent): Promise<string> {
	const { width, height } = kioskLabelDots();
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas 2D is unavailable');

	const {
		name: nameStyle,
		zone: zoneStyle,
		checklist: checkStyle,
		link: linkStyle
	} = KIOSK_LABEL_TEXT;
	const fonts = {
		name: `${nameStyle.weight} ${ptToDots(nameStyle.pt)}px ${FONT_FAMILY}`,
		zone: `${zoneStyle.weight} ${ptToDots(zoneStyle.pt)}px ${FONT_FAMILY}`,
		checklist: `${checkStyle.weight} ${ptToDots(checkStyle.pt)}px ${FONT_FAMILY}`,
		link: `${linkStyle.weight} ${ptToDots(linkStyle.pt)}px ${FONT_FAMILY}`
	};

	// `document.fonts.ready` only waits for faces already in flight — it won't fetch a
	// weight/family this canvas hasn't drawn yet. `fillText` is synchronous, so without an
	// explicit `load()` the first print can race the font fetch and draw with the fallback face.
	const [qr] = await Promise.all([
		loadImage(label.qrSrc),
		document.fonts.ready,
		...Object.values(fonts).map((font) => document.fonts.load(font).catch(() => undefined))
	]);
	const layout = kioskLabelLayout(qr.width);
	const words = segmenter('word');
	const graphemes = segmenter('grapheme');

	context.fillStyle = '#FFFFFF';
	context.fillRect(0, 0, width, height);
	context.imageSmoothingEnabled = false;
	// Whole-dot position keeps every QR module on exact printer dots.
	context.drawImage(qr, layout.qr.x, layout.qr.y);

	context.fillStyle = '#000000';
	context.fillRect(layout.divider.x, layout.divider.y, layout.divider.width, layout.divider.height);
	context.textAlign = 'left';
	context.textBaseline = 'middle';

	let y = layout.text.y;
	const nameSize = ptToDots(nameStyle.pt);
	context.font = fonts.name;
	const measure = (text: string) => context.measureText(text).width;
	// Break between first and last name when each fits a line; the Thai word segmenter splits
	// proper names mid-name, so it only cuts a part too wide for the column.
	const nameSegments = label.name
		.split(/(\s+)/)
		.flatMap((part) => (measure(part.trim()) > layout.text.width ? words(part) : [part]));
	const nameLines = wrapLabelText(
		nameSegments,
		layout.text.width,
		measure,
		nameStyle.maxLines,
		graphemes
	);
	for (const line of nameLines) {
		context.fillText(line, layout.text.x, y + (nameSize * nameStyle.lineHeight) / 2);
		y += nameSize * nameStyle.lineHeight;
	}

	y += mmToDots(KIOSK_LABEL_ZONE.rowGapMm);
	drawZone(context, labelZoneLine(label.zone), fonts.zone, layout.text, y, { words, graphemes });

	// The checklist sits right above the site address, printed small at the very bottom.
	const linkRow = ptToDots(linkStyle.pt) * linkStyle.lineHeight;
	drawChecklist(
		context,
		label.checklist ?? KIOSK_LABEL_CHECKLIST,
		label.checkedCount ?? 0,
		fonts.checklist,
		{ ...layout.text, bottom: layout.text.bottom - linkRow - mmToDots(KIOSK_LABEL_LINK_GAP_MM) }
	);
	context.font = fonts.link;
	context.fillText(KIOSK_LABEL_LINK, layout.link.x, layout.link.y, layout.text.width);

	binarize(context, width, height);
	return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}

/** `Zone:` then the zone name cut to one line, or a dotted rule to write the zone on by hand. */
function drawZone(
	context: CanvasRenderingContext2D,
	zone: LabelZoneLine,
	font: string,
	column: { x: number; width: number },
	top: number,
	segment: { words: (text: string) => string[]; graphemes: (text: string) => string[] }
): void {
	const { pt, lineHeight } = KIOSK_LABEL_TEXT.zone;
	const size = ptToDots(pt);
	const middle = top + (size * lineHeight) / 2;
	const end = column.x + column.width;
	context.font = font;
	const measure = (text: string) => context.measureText(text).width;
	context.fillText(zone.label, column.x, middle);
	const x = column.x + measure(zone.label) + mmToDots(KIOSK_LABEL_ZONE.textGapMm);

	if (zone.value) {
		const [line] = wrapLabelText(segment.words(zone.value), end - x, measure, 1, segment.graphemes);
		if (line) context.fillText(line, x, middle);
		return;
	}
	// Square dots on whole printer dots, about on the text baseline (rows use `middle`).
	const dot = Math.round(mmToDots(KIOSK_LABEL_ZONE.dotMm));
	const pitch = Math.round(mmToDots(KIOSK_LABEL_ZONE.dotPitchMm));
	const ruleY = Math.round(middle + size * 0.35);
	for (let dotX = Math.round(x); dotX + dot <= end; dotX += pitch) {
		context.fillRect(dotX, ruleY, dot, dot);
	}
}

/**
 * One checkbox row per item, anchored to the bottom of the text column like the card's `mt-auto`;
 * the first `checkedCount` boxes get a tick.
 */
function drawChecklist(
	context: CanvasRenderingContext2D,
	items: readonly string[],
	checkedCount: number,
	font: string,
	column: { x: number; width: number; bottom: number }
): void {
	const boxSize = Math.round(mmToDots(KIOSK_LABEL_CHECKBOX.sizeMm));
	const border = Math.max(1, Math.round(mmToDots(KIOSK_LABEL_CHECKBOX.borderMm)));
	const textGap = mmToDots(KIOSK_LABEL_CHECKBOX.textGapMm);
	const rowGap = mmToDots(KIOSK_LABEL_CHECKBOX.rowGapMm);
	const { pt, lineHeight } = KIOSK_LABEL_TEXT.checklist;
	const rowHeight = Math.max(boxSize, ptToDots(pt) * lineHeight);

	context.font = font;
	const boxX = Math.round(column.x);
	let y = column.bottom - items.length * rowHeight - (items.length - 1) * rowGap;
	for (const [index, item] of items.entries()) {
		const middle = y + rowHeight / 2;
		const boxY = Math.round(middle - boxSize / 2);
		context.fillStyle = '#000000';
		context.fillRect(boxX, boxY, boxSize, boxSize);
		context.fillStyle = '#FFFFFF';
		context.fillRect(boxX + border, boxY + border, boxSize - border * 2, boxSize - border * 2);
		context.fillStyle = '#000000';
		if (index < checkedCount) drawTick(context, boxX, boxY, boxSize);
		context.fillText(item, boxX + boxSize + textGap, middle, column.width - boxSize - textGap);
		y += rowHeight + rowGap;
	}
}

/** A check mark inside the `size`-dot box at (`x`, `y`), as on the card's ticked boxes. */
function drawTick(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
	context.strokeStyle = '#000000';
	context.lineWidth = Math.max(2, Math.round(mmToDots(KIOSK_LABEL_CHECKBOX.tickMm)));
	context.lineCap = 'square';
	context.lineJoin = 'miter';
	context.beginPath();
	context.moveTo(x + size * 0.2, y + size * 0.52);
	context.lineTo(x + size * 0.42, y + size * 0.75);
	context.lineTo(x + size * 0.8, y + size * 0.25);
	context.stroke();
}
