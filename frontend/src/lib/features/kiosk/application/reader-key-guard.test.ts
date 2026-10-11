import { describe, expect, it, vi } from 'vitest';
import { installReaderKeyGuard } from './reader-key-guard';

function keydown(timeStamp: number): Event {
	const event = new Event('keydown', { cancelable: true });
	Object.defineProperty(event, 'timeStamp', { value: timeStamp });
	vi.spyOn(event, 'stopPropagation');
	return event;
}

function setup(isExempt = () => false) {
	const target = new EventTarget();
	const remove = installReaderKeyGuard(target, 50, isExempt);
	return { target, remove };
}

describe('installReaderKeyGuard', () => {
	it('swallows a fast burst and its Enter before they can reach a focused numpad button', () => {
		const { target } = setup();
		const events = [0, 4, 8, 12, 16].map(keydown);
		for (const event of events) target.dispatchEvent(event);

		const [first, ...rest] = events;
		expect(first.defaultPrevented).toBe(false);
		for (const event of rest) {
			expect(event.defaultPrevented).toBe(true);
			expect(event.stopPropagation).toHaveBeenCalled();
		}
	});

	it('does not swallow a person typing at human speed', () => {
		const { target } = setup();
		for (const time of [0, 300, 700, 1200]) {
			const event = keydown(time);
			target.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
			expect(event.stopPropagation).not.toHaveBeenCalled();
		}
	});

	it('leaves the screens that read the reader themselves alone', () => {
		const { target } = setup(() => true);
		for (const time of [0, 4, 8]) {
			const event = keydown(time);
			target.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
	});

	it('listens in the capture phase and stops when removed', () => {
		const target = new EventTarget();
		const add = vi.spyOn(target, 'addEventListener');
		const remove = installReaderKeyGuard(target, 50, () => false);
		expect(add).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });

		remove();
		for (const time of [0, 4]) {
			const event = keydown(time);
			target.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
	});
});
