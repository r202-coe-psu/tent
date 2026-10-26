import { KIOSK_LABEL_LINK, kioskLabelDots, ptToDots, wrapLabelText } from '../domain/print-label';
import { VOLUNTEER_LABEL_TEXT, volunteerLabelLayout } from '../domain/volunteer-label';

export type VolunteerLabelContent = {
	/** QR data URL rendered at 1 px per printer dot (see `kioskQrPrintSize`). */
	qrSrc: string;
	name: string;
	badge: string;
};

// loadImage, segmenter, binarize and the font constants are copied from kiosk-label-image.ts
// until the label-zone PR #692 merges and they are extracted.

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
 * Draw one volunteer role-card label at printer resolution and return it as base64 PNG for the
 * scanner client's direct CUPS print.
 */
export async function renderVolunteerLabelPng(label: VolunteerLabelContent): Promise<string> {
	const { width, height } = kioskLabelDots();
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas 2D is unavailable');

	const { name: nameStyle, badge: badgeStyle, link: linkStyle } = VOLUNTEER_LABEL_TEXT;
	const fonts = {
		name: `${nameStyle.weight} ${ptToDots(nameStyle.pt)}px ${FONT_FAMILY}`,
		badge: `${badgeStyle.weight} ${ptToDots(badgeStyle.pt)}px ${FONT_FAMILY}`,
		link: `${linkStyle.weight} ${ptToDots(linkStyle.pt)}px ${FONT_FAMILY}`
	};

	// `fillText` is synchronous, so each font must be explicitly loaded before the first draw.
	const [qr] = await Promise.all([
		loadImage(label.qrSrc),
		document.fonts.ready,
		...Object.values(fonts).map((font) => document.fonts.load(font).catch(() => undefined))
	]);
	const layout = volunteerLabelLayout(qr.width);
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

	const badgeSize = ptToDots(badgeStyle.pt);
	context.font = fonts.badge;
	context.fillText(
		label.badge,
		layout.text.x,
		y + (badgeSize * badgeStyle.lineHeight) / 2,
		layout.text.width
	);

	// Left-aligned in the text column, anchored to its bottom edge.
	context.font = fonts.link;
	context.fillText(KIOSK_LABEL_LINK, layout.link.x, layout.link.y);

	binarize(context, width, height);
	return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}
