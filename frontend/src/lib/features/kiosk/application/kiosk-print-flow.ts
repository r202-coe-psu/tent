import { KioskPrintError, type KioskPrintOutcome } from '../data/kiosk-print.api';

export type KioskPrintFlowResult =
	{ kind: 'printed'; printed: number } | { kind: 'fallback' } | { kind: 'error'; message: string };

export type KioskPrintFlowDeps = {
	renderLabels: () => Promise<readonly string[]>;
	printLabels: (labels: readonly string[]) => Promise<KioskPrintOutcome>;
	/** Runs when no scanner client answered the print endpoint (dev browser / browser print mode). */
	fallbackPrint: () => void | Promise<void>;
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
		const message =
			error instanceof KioskPrintError
				? error.printed > 0
					? `${error.message} (พิมพ์ออกแล้ว ${error.printed} ดวง)`
					: error.message
				: 'สร้าง label สำหรับพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง';
		return { kind: 'error', message };
	}
}
