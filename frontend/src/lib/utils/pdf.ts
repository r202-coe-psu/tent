import jsPDF from 'jspdf';
// Tailwind v4 emits `oklch()` colors, which the original html2canvas can't parse —
// this fork adds oklch/lab/lch support as a drop-in replacement.
import html2canvas from 'html2canvas-pro';

const PX_TO_MM = 25.4 / 96;

/**
 * Rasterizes a DOM element (via html2canvas) and drops it into a jsPDF page
 * sized to match the element's aspect ratio — so the PDF is a pixel-faithful
 * copy of whatever is on screen, not a re-implementation of the layout.
 *
 * `maxWidthMm` caps the physical page size (default a compact card/label
 * size) — the image is scaled down proportionally, never cropped or
 * re-laid-out, so the design stays identical.
 *
 * Opens the result in a new tab using the browser's native PDF viewer, so the
 * user can preview it before printing (viewer's own print button) — no file
 * is downloaded.
 */
export async function previewElementAsPdf(
	element: HTMLElement,
	title: string,
	options: { scale?: number; maxWidthMm?: number } = {}
): Promise<void> {
	const scale = options.scale ?? 3;
	const maxWidthMm = options.maxWidthMm ?? 70;
	const canvas = await html2canvas(element, {
		scale,
		backgroundColor: '#ffffff',
		useCORS: true
	});

	const naturalWidthMm = (canvas.width / scale) * PX_TO_MM;
	const naturalHeightMm = (canvas.height / scale) * PX_TO_MM;

	const shrink = Math.min(1, maxWidthMm / naturalWidthMm);
	const widthMm = naturalWidthMm * shrink;
	const heightMm = naturalHeightMm * shrink;

	const doc = new jsPDF({
		orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
		unit: 'mm',
		format: [widthMm, heightMm]
	});

	doc.setProperties({ title });
	doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, widthMm, heightMm);

	const blobUrl = doc.output('bloburl');
	window.open(blobUrl, '_blank');
}
