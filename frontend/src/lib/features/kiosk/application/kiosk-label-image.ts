import {
	KIOSK_LABEL_CHECKBOX,
	KIOSK_LABEL_CHECKLIST,
	KIOSK_LABEL_TEXT,
	KIOSK_LABEL_TEXT_ROW_GAP_MM,
	kioskLabelDots,
	kioskLabelLayout,
	layoutChecklist,
	mmToDots,
	ptToDots,
	wrapLabelText
} from '../domain/print-label';

export type KioskLabelContent = {
	/** QR data URL rendered at 1 px per printer dot (see `kioskQrPrintSize`). */
	qrSrc: string;
	name: string;
	phone: string | null;
	checklist?: readonly string[];
};

/** Thermal heads print dots, not greys: anything darker than this becomes black. */
const INK_THRESHOLD = 160;
/** Matches the app's typography stack (`$lib/tokens/typography.ts`) so Thai glyphs render
 * instead of the generic sans-serif fallback's tofu boxes on a kiosk without a system Thai font. */
const FONT_FAMILY = "'IBM Plex Sans Thai', sans-serif";
/** The card's `font-mono` phone line (`--font-mono` in app.css). */
const MONO_FAMILY = "'Geist Mono', monospace";

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

	const { name: nameStyle, phone: phoneStyle, checklist: checkStyle } = KIOSK_LABEL_TEXT;
	const fonts = {
		name: `${nameStyle.weight} ${ptToDots(nameStyle.pt)}px ${FONT_FAMILY}`,
		phone: `${phoneStyle.weight} ${ptToDots(phoneStyle.pt)}px ${MONO_FAMILY}`,
		checklist: `${checkStyle.weight} ${ptToDots(checkStyle.pt)}px ${FONT_FAMILY}`
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

	if (label.phone) {
		const phoneSize = ptToDots(phoneStyle.pt);
		y += mmToDots(KIOSK_LABEL_TEXT_ROW_GAP_MM);
		context.font = fonts.phone;
		context.letterSpacing = `${phoneSize * phoneStyle.letterSpacingEm}px`;
		context.fillText(
			label.phone,
			layout.text.x,
			y + (phoneSize * phoneStyle.lineHeight) / 2,
			layout.text.width
		);
		context.letterSpacing = '0px';
	}

	drawChecklist(context, label.checklist ?? KIOSK_LABEL_CHECKLIST, fonts.checklist, layout.text);

	binarize(context, width, height);
	return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}

/** Checkbox rows anchored to the bottom of the text column, like the card's `mt-auto`. */
function drawChecklist(
	context: CanvasRenderingContext2D,
	items: readonly string[],
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
	const rows = layoutChecklist(items, column.width, (text) => context.measureText(text).width, {
		boxSize,
		textGap,
		itemGap: mmToDots(KIOSK_LABEL_CHECKBOX.itemGapMm)
	});
	let y = column.bottom - rows.length * rowHeight - (rows.length - 1) * rowGap;
	for (const row of rows) {
		const middle = y + rowHeight / 2;
		for (const item of row) {
			const boxX = Math.round(column.x + item.x);
			const boxY = Math.round(middle - boxSize / 2);
			context.fillStyle = '#000000';
			context.fillRect(boxX, boxY, boxSize, boxSize);
			context.fillStyle = '#FFFFFF';
			context.fillRect(boxX + border, boxY + border, boxSize - border * 2, boxSize - border * 2);
			context.fillStyle = '#000000';
			context.fillText(item.text, boxX + boxSize + textGap, middle);
		}
		y += rowHeight + rowGap;
	}
}
