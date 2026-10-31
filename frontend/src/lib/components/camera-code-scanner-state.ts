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

/** Tracks the latest read so a result that settles after a cancel or a newer read is dropped. */
export function createReadGuard() {
	let seq = 0;
	return {
		/** Starts a read; the returned check is true only while it is still the latest. */
		begin() {
			const mine = ++seq;
			return () => mine === seq;
		},
		/** Invalidates any read in flight. */
		cancel() {
			seq++;
		}
	};
}
