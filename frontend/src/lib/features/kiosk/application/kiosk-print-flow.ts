import type { LanguageCode } from '$lib/stores/language.svelte';
import { KioskPrintError, type KioskPrintOutcome } from '../data/kiosk-print.api';
import { KIOSK_PRINT_FLOW_I18N } from './kiosk-print-flow.i18n';

export type KioskPrintFlowResult =
	{ kind: 'printed'; printed: number } | { kind: 'fallback' } | { kind: 'error'; message: string };

export type KioskPrintFlowDeps = {
	renderLabels: () => Promise<readonly string[]>;
	printLabels: (labels: readonly string[]) => Promise<KioskPrintOutcome>;
	/** Runs when no scanner client answered the print endpoint (dev browser / browser print mode). */
	fallbackPrint: () => void | Promise<void>;
	/** Language of the error message shown on screen; the printed labels do not follow it. */
	language?: LanguageCode;
};

/**
 * Render → send to the kiosk printer → fall back to `window.print()` only when no scanner client
 * is listening (`printLabels` resolves `unavailable`). A render or print failure never falls back
 * — the caller already has spooled/partial state and re-printing via the browser would duplicate it.
 */
export async function runKioskPrintFlow(deps: KioskPrintFlowDeps): Promise<KioskPrintFlowResult> {
	try {
		const labels = await deps.renderLabels();
		const outcome = await deps.printLabels(labels);
		if (outcome.kind === 'printed') return { kind: 'printed', printed: outcome.printed };
		await deps.fallbackPrint();
		return { kind: 'fallback' };
	} catch (error) {
		const t = KIOSK_PRINT_FLOW_I18N[deps.language ?? 'th'];
		let message: string = t.renderFailed;
		if (error instanceof KioskPrintError) {
			// The printer's own message is kept as it came; only our stock wording follows the language.
			const text =
				error.code === 'connection'
					? t.connection
					: error.code === 'send-failed'
						? t.sendFailed
						: error.message;
			message = error.printed > 0 ? t.printedSoFar(text, error.printed) : text;
		}
		return { kind: 'error', message };
	}
}
