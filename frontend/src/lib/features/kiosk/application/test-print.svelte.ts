import { TEST_PRINT_LABEL_NAME, TEST_PRINT_QR_PAYLOAD } from '../domain/test-print';
import type { KioskPrintFlowResult } from './kiosk-print-flow';
import type { KioskQrImage, KioskQrLabel } from './kiosk-label-print';

/** How long «printed» stays on screen before the status card goes away. */
export const TEST_PRINT_DONE_VISIBLE_MS = 2500;

const RENDER_FAILED_MESSAGE = 'สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ';

export type TestPrintPhase = 'idle' | 'printing' | 'done' | 'error';

export type TestPrintDeps = {
	prepareQrImage: (payload: string) => Promise<KioskQrImage>;
	printLabels: (
		labels: readonly KioskQrLabel[],
		fallbackPrint: () => void | Promise<void>
	) => Promise<KioskPrintFlowResult>;
	/** Runs only when no scanner client answered (dev browser / browser print mode). */
	fallbackPrint: () => void | Promise<void>;
};

/**
 * Staff «test print» from the kiosk device-info panel: print one sample label through the same
 * path as real labels. The panel is only reachable after the staff PIN, so no PIN is asked here.
 */
export class TestPrint {
	phase = $state<TestPrintPhase>('idle');
	error = $state('');
	qrImage = $state.raw<KioskQrImage | null>(null);

	#doneTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly deps: TestPrintDeps) {}

	/** The label is on its way: the page must not send the visitor away meanwhile. */
	get busy(): boolean {
		return this.phase === 'printing';
	}

	/** The one sample label, for the browser-print sheet. Empty until its QR is ready. */
	get labels(): { key: string; qrSrc: string; qrSizeMm: number; name: string }[] {
		return this.qrImage
			? [
					{
						key: 'test-print',
						qrSrc: this.qrImage.src,
						qrSizeMm: this.qrImage.sizeMm,
						name: TEST_PRINT_LABEL_NAME
					}
				]
			: [];
	}

	/** Close the error line. */
	dismiss(): void {
		if (this.phase === 'error' || this.phase === 'done') {
			this.#clearDoneTimer();
			this.error = '';
			this.phase = 'idle';
		}
	}

	/** The panel's button: print the sample label (nothing happens while one is on its way). */
	async print(): Promise<void> {
		if (this.busy) return;
		this.#clearDoneTimer();
		this.error = '';
		this.phase = 'printing';
		try {
			const image = await this.deps.prepareQrImage(TEST_PRINT_QR_PAYLOAD);
			this.qrImage = image;
			const result = await this.deps.printLabels(
				[{ qrSrc: image.src, name: TEST_PRINT_LABEL_NAME }],
				this.deps.fallbackPrint
			);
			switch (result.kind) {
				case 'printed':
					this.phase = 'done';
					this.#doneTimer = setTimeout(() => {
						this.#doneTimer = null;
						if (this.phase === 'done') this.phase = 'idle';
					}, TEST_PRINT_DONE_VISIBLE_MS);
					return;
				case 'fallback':
					this.phase = 'idle';
					return;
				case 'error':
					this.error = result.message;
					this.phase = 'error';
			}
		} catch {
			this.error = RENDER_FAILED_MESSAGE;
			this.phase = 'error';
		}
	}

	destroy(): void {
		this.#clearDoneTimer();
	}

	#clearDoneTimer(): void {
		if (this.#doneTimer) clearTimeout(this.#doneTimer);
		this.#doneTimer = null;
	}
}
