import { createBurstGuard } from '../domain/keyboard-burst-guard';

const CAPTURE = { capture: true } as const;

type KeydownTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/**
 * Keeps a USB QR reader's keystrokes away from whatever element has focus (e.g. the phone numpad
 * would take the digits of the code and Enter would press "search"). Runs in the capture phase and
 * swallows every key after the first of a burst. `isExempt` skips screens that read the reader
 * themselves. Returns the function that removes the listener.
 */
export function installReaderKeyGuard(
	target: KeydownTarget,
	maxGapMs: number,
	isExempt: () => boolean
): () => void {
	const guard = createBurstGuard(maxGapMs);
	const listener = (event: Event) => {
		if (isExempt()) return;
		if (!guard.isBurstKey(event.timeStamp)) return;
		event.preventDefault();
		event.stopPropagation();
	};
	target.addEventListener('keydown', listener, CAPTURE);
	return () => target.removeEventListener('keydown', listener, CAPTURE);
}
