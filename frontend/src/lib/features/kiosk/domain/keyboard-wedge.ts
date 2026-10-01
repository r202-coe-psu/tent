/**
 * Recognises a USB "keyboard wedge" QR reader: it types the whole code in a few milliseconds and
 * ends with Enter, whereas a person typing leaves much longer gaps between keys.
 *
 * Keys are read from `event.code` (the physical key) through a US-layout table, because the reader
 * sends US scancodes: `event.key` follows the OS layout, so with a Thai layout active
 * `evacuee:…` would arrive as Thai letters.
 */
export const WEDGE_MIN_LENGTH = 8;

export type WedgeKey = { key: string; code: string; shiftKey: boolean };

export type KeyboardWedge = {
	/** Feed one keydown; returns the scanned text when this key (Enter) completes a scan. */
	push(input: WedgeKey, timestampMs: number): string | null;
};

const IGNORED_CODES = new Set([
	'ShiftLeft',
	'ShiftRight',
	'ControlLeft',
	'ControlRight',
	'AltLeft',
	'AltRight',
	'MetaLeft',
	'MetaRight',
	'CapsLock'
]);
const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);
const ENTER_CODES = new Set(['Enter', 'NumpadEnter']);
const SHIFTED_DIGITS = ')!@#$%^&*(';

/** code -> [unshifted, shifted] on a US keyboard (letters and digits are handled separately). */
const PUNCTUATION: Record<string, readonly [string, string]> = {
	Semicolon: [';', ':'],
	Minus: ['-', '_'],
	Equal: ['=', '+'],
	Comma: [',', '<'],
	Period: ['.', '>'],
	Slash: ['/', '?'],
	Space: [' ', ' ']
};

type Resolved = { kind: 'ignore' } | { kind: 'enter' } | { kind: 'char'; value: string };

function resolve({ key, code, shiftKey }: WedgeKey): Resolved | null {
	if (IGNORED_CODES.has(code) || IGNORED_KEYS.has(key)) return { kind: 'ignore' };
	if (ENTER_CODES.has(code) || key === 'Enter') return { kind: 'enter' };
	const letter = /^Key([A-Z])$/.exec(code);
	if (letter) return { kind: 'char', value: shiftKey ? letter[1] : letter[1].toLowerCase() };
	const digit = /^Digit([0-9])$/.exec(code);
	if (digit) return { kind: 'char', value: shiftKey ? SHIFTED_DIGITS[Number(digit[1])] : digit[1] };
	const punctuation = PUNCTUATION[code];
	if (punctuation) return { kind: 'char', value: punctuation[shiftKey ? 1 : 0] };
	// Unknown physical key: trust the layout-dependent `key` only if it is a single character.
	return key.length === 1 ? { kind: 'char', value: key } : null;
}

export function createKeyboardWedge(maxGapMs: number): KeyboardWedge {
	let buffer = '';
	let lastAt = Number.NEGATIVE_INFINITY;

	return {
		push(input, timestampMs) {
			const resolved = resolve(input);
			if (resolved?.kind === 'ignore') return null;
			// A pause longer than a reader would leave means a person is typing: start over.
			if (timestampMs - lastAt > maxGapMs) buffer = '';
			lastAt = timestampMs;

			if (resolved?.kind === 'enter') {
				const text = buffer;
				buffer = '';
				return text.length >= WEDGE_MIN_LENGTH ? text : null;
			}
			if (resolved?.kind === 'char') {
				buffer += resolved.value;
			} else {
				buffer = '';
			}
			return null;
		}
	};
}
