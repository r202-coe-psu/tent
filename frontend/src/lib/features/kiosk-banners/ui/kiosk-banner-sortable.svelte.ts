import { dropIndex } from './kiosk-banner-order';

/** Pointer within this many px of the viewport top/bottom scrolls the page while dragging. */
const SCROLL_EDGE_PX = 48;
const SCROLL_STEP_PX = 12;

/**
 * Pointer-event drag state for a vertical list of `<li>` rows (mouse and touch alike). Wire the
 * `start` / `move` / `end` / `cancel` methods to the handle's pointer events; the handle keeps the
 * pointer through `setPointerCapture`. Visual state is read back through {@link rowStyle}.
 */
export class SortableDrag {
	/** Index of the row being dragged, or null when idle. */
	from = $state<number | null>(null);
	/** Index the dragged row would land on if released now. */
	target = $state(0);
	dy = $state(0);
	rowHeight = $state(0);

	#startY = 0;
	#startScroll = 0;
	#midpoints: number[] = [];
	#handle: HTMLElement | null = null;
	#pointerId = 0;
	#onDrop: (from: number, to: number) => void;

	constructor(onDrop: (from: number, to: number) => void) {
		this.#onDrop = onDrop;
	}

	get active() {
		return this.from !== null;
	}

	start(event: PointerEvent, index: number) {
		if (this.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
		const handle = event.currentTarget as HTMLElement;
		const row = handle.closest('li');
		if (!row?.parentElement) return;

		const rows = [...row.parentElement.children];
		this.#midpoints = rows
			.filter((_, i) => i !== index)
			.map((other) => {
				const rect = other.getBoundingClientRect();
				return rect.top + rect.height / 2;
			});
		this.rowHeight = row.getBoundingClientRect().height;
		this.#startY = event.clientY;
		this.#startScroll = window.scrollY;
		this.#handle = handle;
		this.#pointerId = event.pointerId;
		handle.setPointerCapture(event.pointerId);
		this.dy = 0;
		this.target = index;
		this.from = index;
	}

	move(event: PointerEvent) {
		if (this.from === null) return;
		if (event.clientY < SCROLL_EDGE_PX) window.scrollBy(0, -SCROLL_STEP_PX);
		else if (event.clientY > window.innerHeight - SCROLL_EDGE_PX)
			window.scrollBy(0, SCROLL_STEP_PX);
		// Row positions were measured at the start scroll; fold in how far the page has moved since.
		const scrolled = window.scrollY - this.#startScroll;
		this.dy = event.clientY - this.#startY + scrolled;
		this.target = dropIndex(this.#midpoints, event.clientY + scrolled);
	}

	end() {
		if (this.from === null) return;
		const { from, target } = this;
		this.cancel();
		if (target !== from) this.#onDrop(from, target);
	}

	cancel() {
		if (this.from === null) return;
		try {
			this.#handle?.releasePointerCapture(this.#pointerId);
		} catch {
			// The capture may already be gone (pointercancel); nothing to release.
		}
		this.#handle = null;
		this.from = null;
		this.dy = 0;
	}

	/** Inline transform for row `index`: the dragged row follows the pointer, others make room. */
	rowStyle(index: number): string | undefined {
		const { from, target, dy, rowHeight } = this;
		if (from === null) return undefined;
		if (index === from) return `transform: translateY(${dy}px)`;
		if (from < target && index > from && index <= target)
			return `transform: translateY(${-rowHeight}px)`;
		if (target < from && index >= target && index < from)
			return `transform: translateY(${rowHeight}px)`;
		return undefined;
	}
}
