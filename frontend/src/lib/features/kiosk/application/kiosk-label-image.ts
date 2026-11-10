import type { VulnerabilityMarker } from '$lib/utils/vulnerability-marker';
import {
	KIOSK_LABEL_CHECKBOX,
	KIOSK_LABEL_CHECKLIST,
	KIOSK_LABEL_LINK,
	KIOSK_LABEL_LINK_GAP_MM,
	KIOSK_LABEL_MARKER,
	KIOSK_LABEL_QR_CAPTION,
	KIOSK_LABEL_QR_CAPTION_GAP_MM,
	KIOSK_LABEL_TEXT,
	KIOSK_LABEL_ZONE,
	kioskLabelDots,
	kioskLabelLayout,
	labelEmergencyLine,
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
	/** Emergency contact phone, printed on its own row under the zone; none leaves no row. */
	emergencyPhone?: string | null;
	checklist?: readonly string[];
	/** Intake stations passed: this many checklist boxes are ticked, top first. */
	checkedCount?: number;
	/** Vulnerability level printed as a marker row above the name; none leaves no row. */
	marker?: VulnerabilityMarker | null;
};

/** Thermal heads print dots, not greys: anything darker than this becomes black. */
const INK_THRESHOLD = 160;
/** Matches the app's typography stack (`$lib/tokens/typography.ts`) so Thai glyphs render
 * instead of the generic sans-serif fallback's tofu boxes on a kiosk without a system Thai font. */
const FONT_FAMILY = "'IBM Plex Sans Thai Looped', 'IBM Plex Sans Thai', sans-serif";
/** The web font is split by unicode-range; `load()` fetches only the files covering this text. */
const FONT_SAMPLE = 'กขค Aa0';

/**
 * Load `font` for canvas drawing. Rejects when the load fails or no face matched (`load()`
 * resolves `[]`): `fillText` would then silently draw with the fallback face, so a label whose
 * Thai glyphs are tofu boxes would reach the printer. Nothing is cached, so a retry loads again.
 */
async function loadLabelFont(font: string): Promise<void> {
	const faces = await document.fonts.load(font, FONT_SAMPLE);
	if (faces.length === 0) throw new Error(`Label font is unavailable: ${font}`);
}

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
		...Object.values(fonts).map(loadLabelFont)
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
	if (label.marker) {
		y += drawMarker(context, label.marker, fonts.zone, layout.text, y);
		y += mmToDots(KIOSK_LABEL_MARKER.gapMm);
	}
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
	const emergency = labelEmergencyLine(label.emergencyPhone);
	if (emergency) {
		y += ptToDots(zoneStyle.pt) * zoneStyle.lineHeight + mmToDots(KIOSK_LABEL_ZONE.rowGapMm);
		drawEmergency(context, emergency, fonts.checklist, layout.text, y);
	}

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
	drawQrCaption(context, layout.qr, qr.width, linkStyle);

	binarize(context, width, height);
	return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}

/**
 * The vulnerability marker row at `top`, as wide as the text column. Returns its height. Red is a
 * white word on a black band; yellow an outline with a hollow triangle. Uses the zone font and leaves `fillStyle` black.
 */
function drawMarker(
	context: CanvasRenderingContext2D,
	marker: VulnerabilityMarker,
	font: string,
	column: { x: number; width: number },
	top: number
): number {
	const { pt, lineHeight } = KIOSK_LABEL_TEXT.zone;
	const height = Math.round(ptToDots(pt) * lineHeight);
	const left = Math.round(column.x);
	const padding = mmToDots(KIOSK_LABEL_MARKER.paddingMm);
	const middle = top + height / 2;
	context.font = font;
	if (marker === 'red') {
		context.fillStyle = '#000000';
		context.fillRect(left, top, column.width, height);
		context.fillStyle = '#FFFFFF';
		const side = Math.round(height * KIOSK_LABEL_MARKER.glyphRatio);
		context.fillRect(left + padding, Math.round(middle - side / 2), side, side);
		const textX = left + padding + side + mmToDots(KIOSK_LABEL_MARKER.textGapMm);
		context.fillText(
			KIOSK_LABEL_MARKER.text.red,
			textX,
			middle,
			Math.max(1, left + column.width - padding - textX)
		);
	} else {
		// Outline stays inside the column: the stroke is centred on the rect's edge.
		const border = Math.max(1, Math.round(mmToDots(KIOSK_LABEL_MARKER.borderMm)));
		context.strokeStyle = '#000000';
		context.lineWidth = border;
		context.strokeRect(left + border / 2, top + border / 2, column.width - border, height - border);
		const side = Math.round(height * KIOSK_LABEL_MARKER.glyphRatio);
		const triangleX = left + padding;
		const triangleTop = Math.round(middle - side / 2);
		context.lineWidth = Math.max(1, Math.round(mmToDots(KIOSK_LABEL_MARKER.triangleStrokeMm)));
		context.lineJoin = 'miter';
		context.beginPath();
		context.moveTo(triangleX, triangleTop + side);
		context.lineTo(triangleX + side / 2, triangleTop);
		context.lineTo(triangleX + side, triangleTop + side);
		context.closePath();
		context.stroke();
		const textX = triangleX + side + mmToDots(KIOSK_LABEL_MARKER.textGapMm);
		context.fillStyle = '#000000';
		context.fillText(
			KIOSK_LABEL_MARKER.text.yellow,
			textX,
			middle,
			Math.max(1, left + column.width - padding - textX)
		);
	}
	context.fillStyle = '#000000';
	return height;
}

/**
 * The "for use inside the shelter" lines centred under the QR. Left-aligned at a measured x, so
 * every row on the label keeps the same `textAlign`. Uses the font already set for the link.
 */
function drawQrCaption(
	context: CanvasRenderingContext2D,
	qr: { x: number; y: number },
	qrSize: number,
	style: { pt: number; lineHeight: number }
): void {
	const row = ptToDots(style.pt) * style.lineHeight;
	const centre = qr.x + qrSize / 2;
	let middle = qr.y + qrSize + mmToDots(KIOSK_LABEL_QR_CAPTION_GAP_MM) + row / 2;
	for (const line of KIOSK_LABEL_QR_CAPTION) {
		context.fillText(line, centre - context.measureText(line).width / 2, middle);
		middle += row;
	}
}

/** `ติดต่อฉุกเฉิน:` then the phone, squeezed into the column rather than cut. */
function drawEmergency(
	context: CanvasRenderingContext2D,
	line: { label: string; value: string | null },
	font: string,
	column: { x: number; width: number },
	top: number
): void {
	const { pt, lineHeight } = KIOSK_LABEL_TEXT.emergency;
	const middle = top + (ptToDots(pt) * lineHeight) / 2;
	context.font = font;
	context.fillText(line.label, column.x, middle, column.width);
	const x = column.x + context.measureText(line.label).width + mmToDots(KIOSK_LABEL_ZONE.textGapMm);
	if (line.value) context.fillText(line.value, x, middle, Math.max(1, column.x + column.width - x));
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
