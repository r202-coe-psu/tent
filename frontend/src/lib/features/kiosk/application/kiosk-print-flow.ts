import type { LanguageCode } from '$lib/stores/language.svelte';
import type { KioskPrinter } from '../domain/kiosk-hardware';
import { KioskPrintError, type KioskPrintOutcome } from '../data/kiosk-print.api';
import { KIOSK_PRINT_FLOW_I18N } from './kiosk-print-flow.i18n';

export type KioskPrintFlowResult =
	| { kind: 'printed'; printed: number }
	| { kind: 'fallback' }
	/** The kiosk has no printer: the rendered label PNGs (base64, in order) are shown on screen. */
	| { kind: 'screen'; labels: readonly string[] }
	/** `labels` are the rendered PNGs that did not print, so the screen can show them instead. */
	| { kind: 'error'; message: string; labels?: readonly string[] };

export type KioskPrintFlowDeps = {
	renderLabels: () => Promise<readonly string[]>;
	printLabels: (labels: readonly string[]) => Promise<KioskPrintOutcome>;
	/** Runs when no scanner client answered the print endpoint (dev browser / browser print mode). */
	fallbackPrint: () => void | Promise<void>;
	/** Language of the error message shown on screen; the printed labels do not follow it. */
	language?: LanguageCode;
	/** Which printer the kiosk has; `none` shows the labels on screen instead of printing. */
	printer?: KioskPrinter;
};

/**
 * Render → send to the kiosk printer → fall back to `window.print()` only when no scanner client
 * is listening (`printLabels` resolves `unavailable`). A render or print failure never falls back
 * — the caller already has spooled/partial state and re-printing via the browser would duplicate it.
 */
export async function runKioskPrintFlow(deps: KioskPrintFlowDeps): Promise<KioskPrintFlowResult> {
	let labels: readonly string[] = [];
	try {
		labels = await deps.renderLabels();
		if (deps.printer === 'none') return { kind: 'screen', labels };
		const outcome = await deps.printLabels(labels);
		if (outcome.kind === 'printed') return { kind: 'printed', printed: outcome.printed };
		await deps.fallbackPrint();
		return { kind: 'fallback' };
	} catch (error) {
		const t = KIOSK_PRINT_FLOW_I18N[deps.language ?? 'th'];
		let message: string = deps.printer === 'none' ? t.screenRenderFailed : t.renderFailed;
		if (error instanceof KioskPrintError) {
			// The printer's own message is kept as it came; only our stock wording follows the language.
			const stockText = {
				connection: t.connection,
				'send-failed': t.sendFailed,
				'not-ready': t.notReady,
				disabled: t.disabled
			};
			const text = error.code ? stockText[error.code] : error.message;
			message = error.printed > 0 ? t.printedSoFar(text, error.printed) : text;
		}
		const unprinted = error instanceof KioskPrintError ? labels.slice(error.printed) : labels;
		return { kind: 'error', message, labels: unprinted };
	}
}
