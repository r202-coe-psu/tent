import { DEFAULT_KIOSK_HARDWARE, type KioskPrinter } from '../domain/kiosk-hardware';
import { loadKioskHardware } from './kiosk-qr-input';

/**
 * The machine's printer, learnt once when a print flow mounts. Until the scanner client answers
 * (or if it never does) the flow keeps the default printer and its printing wording. This is the
 * one place the printer is resolved: pass `printer` on to the print functions instead of letting
 * them fetch the hardware again, so what the screen shows and what gets printed cannot diverge.
 */
export class KioskPrinterState {
	printer = $state<KioskPrinter>(DEFAULT_KIOSK_HARDWARE.printer);
	hasNoPrinter = $derived(this.printer === 'none');
	/** Settles once the machine's printer is known; a flow that prints on mount waits for it. */
	readonly ready: Promise<void>;

	constructor() {
		this.ready = loadKioskHardware().then((hardware) => {
			this.printer = hardware.printer;
		});
	}
}
