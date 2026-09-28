import {
	KIOSK_LABEL_GAP_MM,
	KIOSK_LABEL_OFFSET_X_MM,
	KIOSK_LABEL_PADDING_MM,
	KIOSK_LABEL_TEXT,
	KIOSK_LABEL_TEXT_ROW_GAP_MM,
	kioskLabelDots,
	mmToDots,
	ptToDots,
	wrapLabelText
} from '../domain/print-label';

export type KioskLabelContent = {
	/** QR data URL rendered at 1 px per printer dot (see `kioskQrPrintSize`). */
	qrSrc: string;
	caption: string;
	name: string;
	detail: string;
};

/** Thermal heads print dots, not greys: anything darker than this becomes black. */
const INK_THRESHOLD = 160;
const FONT_FAMILY = 'sans-serif';

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
 * Draw one kiosk label (same layout as the `.wristband` print CSS) at printer resolution and
 * return it as base64 PNG for the scanner client's direct CUPS print.
 */
export async function renderKioskLabelPng(label: KioskLabelContent): Promise<string> {
	const { width, height } = kioskLabelDots();
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas 2D is unavailable');

	const [qr] = await Promise.all([loadImage(label.qrSrc), document.fonts.ready]);
	const padding = mmToDots(KIOSK_LABEL_PADDING_MM);
	const centerX = width / 2 + mmToDots(KIOSK_LABEL_OFFSET_X_MM);
	const maxTextWidth = width - padding * 2;
	const words = segmenter('word');
	const graphemes = segmenter('grapheme');

	context.fillStyle = '#FFFFFF';
	context.fillRect(0, 0, width, height);
	context.imageSmoothingEnabled = false;
	// Whole-dot position keeps every QR module on exact printer dots.
	context.drawImage(qr, Math.round(centerX - qr.width / 2), Math.round(padding));

	let y = padding + qr.height + mmToDots(KIOSK_LABEL_GAP_MM);
	context.fillStyle = '#000000';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	const rows = [
		{ text: label.caption, style: KIOSK_LABEL_TEXT.caption, maxLines: 1 },
		{ text: label.name, style: KIOSK_LABEL_TEXT.name, maxLines: KIOSK_LABEL_TEXT.name.maxLines },
		{ text: label.detail, style: KIOSK_LABEL_TEXT.detail, maxLines: 1 }
	];
	for (const [index, row] of rows.entries()) {
		if (index > 0) y += mmToDots(KIOSK_LABEL_TEXT_ROW_GAP_MM);
		const fontSize = ptToDots(row.style.pt);
		const lineHeight = fontSize * row.style.lineHeight;
		context.font = `${row.style.weight} ${fontSize}px ${FONT_FAMILY}`;
		const lines = wrapLabelText(
			words(row.text),
			maxTextWidth,
			(text) => context.measureText(text).width,
			row.maxLines,
			graphemes
		);
		for (const line of lines) {
			context.fillText(line, centerX, y + lineHeight / 2, maxTextWidth);
			y += lineHeight;
		}
	}

	binarize(context, width, height);
	return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}
