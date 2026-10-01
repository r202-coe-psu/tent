import { describe, expect, it } from 'vitest';
import { createKeyboardWedge, WEDGE_MIN_LENGTH, type WedgeKey } from './keyboard-wedge';

type Wedge = ReturnType<typeof createKeyboardWedge>;

const CODE_FOR: Record<string, string> = { ':': 'Semicolon', '-': 'Minus' };

/** A US-layout keydown for one character: what the reader's scancodes produce. */
function usKey(char: string, key = char): WedgeKey {
	if (/^[a-z]$/i.test(char)) {
		return { key, code: `Key${char.toUpperCase()}`, shiftKey: char !== char.toLowerCase() };
	}
	if (/^[0-9]$/.test(char)) return { key, code: `Digit${char}`, shiftKey: false };
	return { key, code: CODE_FOR[char], shiftKey: char === ':' };
}

const ENTER: WedgeKey = { key: 'Enter', code: 'Enter', shiftKey: false };

/** Types `text` then Enter, `gapMs` apart; `keyFor` overrides `event.key` (layout-dependent). */
function type(
	wedge: Wedge,
	text: string,
	start: number,
	gapMs: number,
	keyFor: (char: string) => string = (char) => char
) {
	const results: string[] = [];
	let now = start;
	for (const input of [...[...text].map((char) => usKey(char, keyFor(char))), ENTER]) {
		const result = wedge.push(input, now);
		if (result !== null) results.push(result);
		now += gapMs;
	}
	return results;
}

describe('createKeyboardWedge', () => {
	it('returns a fast burst that ends with Enter', () => {
		expect(type(createKeyboardWedge(50), 'evacuee:TEST-0001', 1000, 5)).toEqual([
			'evacuee:TEST-0001'
		]);
	});

	it('spells the code from the physical keys whatever event.key says (Thai layout, IME)', () => {
		const thai = (char: string) => (char === ':' ? 'ซ' : 'ก');
		const ime = () => 'Process';
		expect(type(createKeyboardWedge(50), 'evacuee:01J0ABCDEF', 0, 5, thai)).toEqual([
			'evacuee:01J0ABCDEF'
		]);
		expect(type(createKeyboardWedge(50), 'evacuee:01J0ABCDEF', 0, 5, ime)).toEqual([
			'evacuee:01J0ABCDEF'
		]);
	});

	it('maps Shift + Semicolon to a colon and plain Semicolon to a semicolon', () => {
		const wedge = createKeyboardWedge(50);
		let now = 0;
		for (const char of 'evacuee') wedge.push(usKey(char), (now += 4));
		wedge.push({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }, (now += 4));
		wedge.push({ key: 'ซ', code: 'Semicolon', shiftKey: true }, (now += 4));
		wedge.push({ key: 'ซ', code: 'Semicolon', shiftKey: false }, (now += 4));
		expect(wedge.push(ENTER, now + 4)).toBe('evacuee:;');
	});

	it('ignores a person typing slowly', () => {
		expect(type(createKeyboardWedge(50), 'evacuee:TEST-0001', 1000, 300)).toEqual([]);
	});

	it('ignores input shorter than the minimum length', () => {
		const short = 'x'.repeat(WEDGE_MIN_LENGTH - 1);
		expect(type(createKeyboardWedge(50), short, 0, 5)).toEqual([]);
		expect(type(createKeyboardWedge(50), 'x'.repeat(WEDGE_MIN_LENGTH), 0, 5)).toHaveLength(1);
	});

	it('treats a gap equal to the limit as still part of the scan, one more ms as a pause', () => {
		expect(type(createKeyboardWedge(50), 'evacuee:TEST', 0, 50)).toEqual(['evacuee:TEST']);
		expect(type(createKeyboardWedge(50), 'evacuee:TEST', 0, 51)).toEqual([]);
	});

	it('does not count a slow pause before Enter as part of a scan, even with a full buffer', () => {
		const wedge = createKeyboardWedge(50);
		for (const [index, char] of [...'evacuee:TEST'].entries()) wedge.push(usKey(char), index * 5);
		expect(wedge.push(ENTER, 5000)).toBeNull();
	});

	it('does not let a modifier key bridge a pause', () => {
		const wedge = createKeyboardWedge(50);
		for (const [index, char] of [...'evacuee'].entries()) wedge.push(usKey(char), index * 5);
		// 100 ms pause: the Shift press alone must not make the next character look continuous.
		wedge.push({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }, 130);
		wedge.push(usKey('X'), 140);
		expect(wedge.push(ENTER, 145)).toBeNull();
	});

	it('restarts the count after a pause so typed junk before a scan is dropped', () => {
		const wedge = createKeyboardWedge(50);
		wedge.push(usKey('a'), 0);
		wedge.push(usKey('b'), 10);
		expect(type(wedge, 'evacuee:TEST-0001', 2000, 5)).toEqual(['evacuee:TEST-0001']);
	});

	it('separates back-to-back scans', () => {
		const wedge = createKeyboardWedge(50);
		const first = type(wedge, 'evacuee:AAAAAAAA', 0, 5);
		const second = type(wedge, 'evacuee:BBBBBBBB', 200, 5);
		expect([...first, ...second]).toEqual(['evacuee:AAAAAAAA', 'evacuee:BBBBBBBB']);
	});

	it('discards the buffer on an unmapped non-printing key such as Backspace', () => {
		const wedge = createKeyboardWedge(50);
		for (const [index, char] of [...'evacuee:TEST'].entries()) wedge.push(usKey(char), index);
		wedge.push({ key: 'Backspace', code: 'Backspace', shiftKey: false }, 20);
		expect(wedge.push(ENTER, 25)).toBeNull();
	});
});
