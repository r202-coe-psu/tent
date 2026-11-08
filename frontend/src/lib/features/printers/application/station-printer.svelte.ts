const storageKey = (shelterCode: string) => `tent.printer.${shelterCode}`;

function readStored(shelterCode: string): string | null {
	try {
		const value = localStorage.getItem(storageKey(shelterCode));
		return value && value.length > 0 ? value : null;
	} catch {
		// Storage blocked (private mode) or absent (non-browser): behave as "nothing chosen".
		return null;
	}
}

function writeStored(shelterCode: string, printerId: string | null): void {
	try {
		if (printerId) localStorage.setItem(storageKey(shelterCode), printerId);
		else localStorage.removeItem(storageKey(shelterCode));
	} catch {
		/* quota / private mode: the in-memory choice still holds for this session */
	}
}

/** The printer this tablet prints to, remembered per shelter (`tent.printer.<code>`). */
export class StationPrinterStore {
	/** Choices made in this session; wins over storage so a failed write is not lost. */
	#chosen = $state<Record<string, string | null>>({});

	get(shelterCode: string): string | null {
		if (shelterCode in this.#chosen) return this.#chosen[shelterCode];
		return readStored(shelterCode);
	}

	set(shelterCode: string, printerId: string | null): void {
		this.#chosen[shelterCode] = printerId;
		writeStored(shelterCode, printerId);
	}
}

export const stationPrinter = new StationPrinterStore();
