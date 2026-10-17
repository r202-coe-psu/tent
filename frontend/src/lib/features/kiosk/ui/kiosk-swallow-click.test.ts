// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { swallowNextClick } from './kiosk-swallow-click';

describe('swallowNextClick', () => {
	let card: HTMLButtonElement;
	let onCardClick: Mock<() => void>;

	beforeEach(() => {
		vi.useFakeTimers();
		onCardClick = vi.fn<() => void>();
		card = document.createElement('button');
		card.addEventListener('click', onCardClick);
		document.body.append(card);
	});
	afterEach(() => {
		vi.useRealTimers();
		document.body.innerHTML = '';
	});

	it('stops the next click before it reaches the element underneath', () => {
		swallowNextClick(window);

		card.click();

		expect(onCardClick).not.toHaveBeenCalled();
	});

	it('swallows only one click', () => {
		swallowNextClick(window);

		card.click();
		card.click();

		expect(onCardClick).toHaveBeenCalledTimes(1);
	});

	it('gives up when no click follows (a drag or a held key), leaving no timer behind', () => {
		swallowNextClick(window);

		vi.advanceTimersByTime(1_000);
		card.click();

		expect(onCardClick).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('can be cancelled', () => {
		const cancel = swallowNextClick(window);

		cancel();
		card.click();

		expect(onCardClick).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
