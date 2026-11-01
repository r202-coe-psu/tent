import { isDeskMode, type DeskMode } from './desk-mode';

const STORAGE_KEY = 'distribution-desk-mode';

/** Per-device convenience only: any storage failure falls back to "no remembered mode". */
export function readStoredDeskMode(): DeskMode | null {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return isDeskMode(value) ? value : null;
	} catch {
		return null;
	}
}

export function storeDeskMode(mode: DeskMode): void {
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// Storage can be blocked or full; the mode still works for this visit.
	}
}
