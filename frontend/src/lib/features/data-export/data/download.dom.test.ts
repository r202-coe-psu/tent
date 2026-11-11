// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './download';

describe('downloadBlob', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		URL.createObjectURL = vi.fn(() => 'blob:test');
		URL.revokeObjectURL = vi.fn();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('clicks an anchor that is attached to the DOM, then removes it (Firefox)', () => {
		let attachedOnClick = false;
		const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
			this: HTMLAnchorElement
		) {
			attachedOnClick = document.body.contains(this);
		});

		downloadBlob(new Blob(['x']), 'a.xlsx');

		expect(attachedOnClick).toBe(true);
		const clicked = spy.mock.contexts[0] as HTMLAnchorElement;
		expect(clicked.download).toBe('a.xlsx');
		expect(clicked.href).toBe('blob:test');
		expect(document.body.contains(clicked)).toBe(false);
	});

	it('revokes the object URL after the click is handled', () => {
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		downloadBlob(new Blob(['x']), 'a.xlsx');
		expect(URL.revokeObjectURL).not.toHaveBeenCalled();
		vi.runAllTimers();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
	});
});
