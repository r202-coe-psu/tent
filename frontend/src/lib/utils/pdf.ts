import jsPDF from 'jspdf';
// Tailwind v4 emits `oklch()` colors, which the original html2canvas can't parse —
// this fork adds oklch/lab/lch support as a drop-in replacement.
import html2canvas from 'html2canvas-pro';

const PX_TO_MM = 25.4 / 96;

function inlineComputedStyles(source: Element, target: Element): void {
	const sourceWindow = source.ownerDocument.defaultView;
	if (sourceWindow && 'style' in target) {
		const computedStyle = sourceWindow.getComputedStyle(source);
		const targetStyle = (target as HTMLElement | SVGElement).style;

		for (let index = 0; index < computedStyle.length; index += 1) {
			const property = computedStyle.item(index);
			targetStyle.setProperty(
				property,
				computedStyle.getPropertyValue(property),
				computedStyle.getPropertyPriority(property)
			);
		}
	}

	const childCount = Math.min(source.children.length, target.children.length);
	for (let index = 0; index < childCount; index += 1) {
		inlineComputedStyles(source.children[index], target.children[index]);
	}
}

export type RenderPdfOptions = { scale?: number; maxWidthMm?: number; timeoutMs?: number };

/**
 * html2canvas walks and rasterizes a cloned DOM tree in an offscreen iframe; on
 * a low-end phone at `scale: 3` that is a second or two of main-thread work, and
 * a webfont or image that never settles can leave the promise pending forever.
 * The caller's spinner would then spin until the tab is closed. Time it out so
 * the UI can show a real error instead — 20s is far past any honest render.
 */
const DEFAULT_RENDER_TIMEOUT_MS = 20_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const expiry = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	// `finally` on the race, not on `work`: clearing the timer as soon as either
	// side settles is what stops a stuck render from holding the timer (and the
	// event loop in tests) open after the caller has already given up.
	return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

/**
 * Rasterizes a DOM element (via html2canvas) and drops it into a jsPDF page
 * sized to match the element's aspect ratio — so the PDF is a pixel-faithful
 * copy of whatever is on screen, not a re-implementation of the layout.
 *
 * `maxWidthMm` caps the physical page size (default a compact card/label
 * size) — the image is scaled down proportionally, never cropped or
 * re-laid-out, so the design stays identical.
 *
 * Shared by both delivery modes below; it produces the document and takes no
 * view on whether the user gets a preview tab or a file.
 */
async function renderElementToPdf(
	element: HTMLElement,
	title: string,
	options: RenderPdfOptions = {}
): Promise<jsPDF> {
	const scale = options.scale ?? 3;
	const maxWidthMm = options.maxWidthMm ?? 70;
	const canvas = await withTimeout(
		html2canvas(element, {
			scale,
			backgroundColor: '#ffffff',
			useCORS: true,
			// Production serves the compiled Tailwind/Svelte CSS as external stylesheets.
			// Freeze the resolved styles into the cloned tree so PDF rendering does not
			// depend on those stylesheets loading again inside html2canvas's hidden iframe.
			onclone: (_document, clonedElement) => inlineComputedStyles(element, clonedElement)
		}),
		options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS,
		'สร้างไฟล์ PDF ใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง'
	);

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

	return doc;
}

/**
 * Opens the rendered PDF in a new tab using the browser's native PDF viewer, so
 * the user can preview it before printing (viewer's own print button) — no file
 * is downloaded.
 */
export async function previewElementAsPdf(
	element: HTMLElement,
	title: string,
	options: RenderPdfOptions & { previewWindow?: Window } = {}
): Promise<void> {
	const doc = await renderElementToPdf(element, title, options);
	const blobUrl = doc.output('bloburl');
	if (options.previewWindow) {
		if (options.previewWindow.closed) {
			throw new Error('หน้าต่างตัวอย่าง PDF ถูกปิด กรุณาลองใหม่อีกครั้ง');
		}
		options.previewWindow.location.href = blobUrl.toString();
		return;
	}

	if (!window.open(blobUrl, '_blank')) {
		throw new Error('เบราว์เซอร์บล็อกหน้าต่าง PDF กรุณาอนุญาตป๊อปอัปแล้วลองใหม่');
	}
}

/**
 * Saves the rendered PDF straight to the user's downloads as `<filename>.pdf`.
 *
 * The counterpart to {@link previewElementAsPdf}: no preview tab and no native
 * print dialog, so nothing can be blocked as a popup and the citizen keeps a
 * file rather than a window they have to act on. `jsPDF.save()` drives an
 * anchor click internally, which is why this needs no popup permission.
 */
export async function downloadElementAsPdf(
	element: HTMLElement,
	filename: string,
	options: RenderPdfOptions = {}
): Promise<void> {
	const doc = await renderElementToPdf(element, filename, options);
	doc.save(filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`);
}
