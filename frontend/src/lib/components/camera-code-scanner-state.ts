/** Scanner lifecycle after a code is read: `busy` while the caller resolves the last read. */
export type ScannerPhase = 'idle' | 'busy';

export function scannerPhase(busy: boolean): ScannerPhase {
	return busy ? 'busy' : 'idle';
}

/** A read is accepted only when idle and non-empty; further reads while busy are ignored. */
export function acceptRead(phase: ScannerPhase, code: string): string | null {
	const clean = code.trim();
	return phase === 'idle' && clean ? clean : null;
}
