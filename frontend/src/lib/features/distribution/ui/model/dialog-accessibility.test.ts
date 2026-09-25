// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dialogAccessibility } from './dialog-accessibility';

describe('dialogAccessibility action', () => {
	let container: HTMLDivElement;
	let triggerBtn: HTMLButtonElement;
	let dialogNode: HTMLDivElement;
	let btn1: HTMLButtonElement;
	let input1: HTMLInputElement;
	let btn2: HTMLButtonElement;

	beforeEach(() => {
		container = document.createElement('div');
		triggerBtn = document.createElement('button');
		triggerBtn.id = 'trigger-btn';
		container.appendChild(triggerBtn);

		dialogNode = document.createElement('div');
		btn1 = document.createElement('button');
		btn1.id = 'btn-1';
		input1 = document.createElement('input');
		input1.id = 'input-1';
		btn2 = document.createElement('button');
		btn2.id = 'btn-2';

		dialogNode.appendChild(btn1);
		dialogNode.appendChild(input1);
		dialogNode.appendChild(btn2);
		container.appendChild(dialogNode);
		document.body.appendChild(container);

		triggerBtn.focus();
	});

	afterEach(() => {
		if (container.parentNode) {
			container.parentNode.removeChild(container);
		}
		vi.restoreAllMocks();
	});

	it('restores focus to previous active element on destroy', () => {
		triggerBtn.focus();
		expect(document.activeElement).toBe(triggerBtn);

		const onClose = vi.fn();
		const action = dialogAccessibility(dialogNode, {
			canClose: () => true,
			onClose
		});

		action.destroy();
		expect(document.activeElement).toBe(triggerBtn);
	});

	it('invokes onClose when Escape is pressed and canClose is true', () => {
		const onClose = vi.fn();
		const action = dialogAccessibility(dialogNode, {
			canClose: () => true,
			onClose
		});

		const escEvent = new KeyboardEvent('keydown', {
			key: 'Escape',
			bubbles: true,
			cancelable: true
		});
		window.dispatchEvent(escEvent);

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(escEvent.defaultPrevented).toBe(true);

		action.destroy();
	});

	it('does NOT invoke onClose when Escape is pressed and canClose is false (e.g. pending/fenced state)', () => {
		const onClose = vi.fn();
		const action = dialogAccessibility(dialogNode, {
			canClose: () => false,
			onClose
		});

		const escEvent = new KeyboardEvent('keydown', {
			key: 'Escape',
			bubbles: true,
			cancelable: true
		});
		window.dispatchEvent(escEvent);

		expect(onClose).not.toHaveBeenCalled();
		expect(escEvent.defaultPrevented).toBe(true);

		action.destroy();
	});

	it('traps tab focus forward from last to first element', () => {
		const onClose = vi.fn();
		const action = dialogAccessibility(dialogNode, {
			canClose: () => true,
			onClose
		});

		btn2.focus();
		expect(document.activeElement).toBe(btn2);

		const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		window.dispatchEvent(tabEvent);

		expect(tabEvent.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(btn1);

		action.destroy();
	});

	it('traps tab focus backward (Shift+Tab) from first to last element', () => {
		const onClose = vi.fn();
		const action = dialogAccessibility(dialogNode, {
			canClose: () => true,
			onClose
		});

		btn1.focus();
		expect(document.activeElement).toBe(btn1);

		const shiftTabEvent = new KeyboardEvent('keydown', {
			key: 'Tab',
			shiftKey: true,
			bubbles: true,
			cancelable: true
		});
		window.dispatchEvent(shiftTabEvent);

		expect(shiftTabEvent.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(btn2);

		action.destroy();
	});
});
