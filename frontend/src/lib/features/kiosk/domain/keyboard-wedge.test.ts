import { describe, expect, it } from 'vitest';
import { createKeyboardWedge, WEDGE_MIN_LENGTH } from './keyboard-wedge';

/** Types `text` then Enter, `gapMs` apart, starting at `start`; returns every non-null result. */
function type(
	wedge: ReturnType<typeof createKeyboardWedge>,
	text: string,
	start: number,
	gapMs: number
) {
	const results: string[] = [];
	let now = start;
	for (const key of [...text, 'Enter']) {
		const result = wedge.push(key, now);
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

	it('ignores a person typing slowly', () => {
		expect(type(createKeyboardWedge(50), 'evacuee:TEST-0001', 1000, 300)).toEqual([]);
	});

	it('ignores input shorter than the minimum length', () => {
		const short = 'x'.repeat(WEDGE_MIN_LENGTH - 1);
		expect(type(createKeyboardWedge(50), short, 0, 5)).toEqual([]);
		expect(type(createKeyboardWedge(50), 'x'.repeat(WEDGE_MIN_LENGTH), 0, 5)).toHaveLength(1);
	});

	it('does not count a slow pause before Enter as part of a scan', () => {
		const wedge = createKeyboardWedge(50);
		for (const [index, key] of [...'evacuee:TEST'].entries()) wedge.push(key, index * 5);
		expect(wedge.push('Enter', 5000)).toBeNull();
	});

	it('restarts the count after a pause so typed junk before a scan is dropped', () => {
		const wedge = createKeyboardWedge(50);
		wedge.push('a', 0);
		wedge.push('b', 10);
		expect(type(wedge, 'evacuee:TEST-0001', 2000, 5)).toEqual(['evacuee:TEST-0001']);
	});

	it('keeps characters that need Shift and ignores the modifier key itself', () => {
		const wedge = createKeyboardWedge(50);
		let now = 0;
		for (const key of ['e', 'v', 'a', 'c', 'u', 'e', 'e', 'Shift', ':', 'Shift', 'T', '-', '1']) {
			wedge.push(key, (now += 4));
		}
		expect(wedge.push('Enter', now + 4)).toBe('evacuee:T-1');
	});

	it('separates back-to-back scans', () => {
		const wedge = createKeyboardWedge(50);
		const first = type(wedge, 'evacuee:AAAAAAAA', 0, 5);
		const second = type(wedge, 'evacuee:BBBBBBBB', 200, 5);
		expect([...first, ...second]).toEqual(['evacuee:AAAAAAAA', 'evacuee:BBBBBBBB']);
	});

	it('discards the buffer on non-printing keys such as Backspace', () => {
		const wedge = createKeyboardWedge(50);
		for (const [index, key] of [...'evacuee:TEST'].entries()) wedge.push(key, index);
		wedge.push('Backspace', 20);
		expect(wedge.push('Enter', 25)).toBeNull();
	});
});
