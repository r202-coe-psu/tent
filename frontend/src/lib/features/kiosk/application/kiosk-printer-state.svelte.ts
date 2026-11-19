import { loadKioskHardware } from './kiosk-qr-input';

/**
 * Whether this machine has no printer, learnt once when a print flow mounts. Until the scanner
 * client answers (or if it never does) the flow keeps its printing wording.
 */
export class KioskPrinterState {
	hasNoPrinter = $state(false);
	/** Settles once the machine's printer is known; a flow that prints on mount waits for it. */
	readonly ready: Promise<void>;

	constructor() {
		this.ready = loadKioskHardware().then((hardware) => {
			this.hasNoPrinter = hardware.printer === 'none';
		});
	}
}
