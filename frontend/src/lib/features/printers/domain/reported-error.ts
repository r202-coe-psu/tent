/**
 * Thrown from a `renderLabels` callback after it already showed its own specific toast, so
 * `PrintLabelsButton` stops without adding its generic "render failed" toast on top.
 */
export class ReportedRenderError extends Error {
	constructor(message = 'Render failed; already reported to the user') {
		super(message);
		this.name = 'ReportedRenderError';
	}
}
