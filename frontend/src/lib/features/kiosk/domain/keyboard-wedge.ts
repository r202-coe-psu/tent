/**
 * Recognises a USB "keyboard wedge" QR reader: it types the whole code in a few milliseconds and
 * ends with Enter, whereas a person typing leaves much longer gaps between keys.
 */
export const WEDGE_MIN_LENGTH = 8;

const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);

export type KeyboardWedge = {
	/** Feed one keydown; returns the scanned text when this key (Enter) completes a scan. */
	push(key: string, timestampMs: number): string | null;
};

export function createKeyboardWedge(maxGapMs: number): KeyboardWedge {
	let buffer = '';
	let lastAt = Number.NEGATIVE_INFINITY;

	return {
		push(key, timestampMs) {
			if (IGNORED_KEYS.has(key)) return null;
			// A pause longer than a reader would leave means a person is typing: start over.
			if (timestampMs - lastAt > maxGapMs) buffer = '';
			lastAt = timestampMs;

			if (key === 'Enter') {
				const text = buffer;
				buffer = '';
				return text.length >= WEDGE_MIN_LENGTH ? text : null;
			}
			if (key.length === 1) {
				buffer += key;
			} else {
				buffer = '';
			}
			return null;
		}
	};
}
