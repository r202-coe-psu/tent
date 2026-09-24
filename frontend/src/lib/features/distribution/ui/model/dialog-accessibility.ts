export interface DialogAccessibilityOptions {
	/**
	 * Callback returning whether the dialog can safely close.
	 * Must return false if an async mutation is pending, operation is fenced,
	 * or workflow is in an irreversible forward-only recovery state.
	 */
	canClose: () => boolean;

	/**
	 * Callback executed when the dialog is dismissed via Escape key or backdrop.
	 */
	onClose: () => void;

	/**
	 * Optional selector for the element to focus upon dialog opening.
	 * Defaults to the first focusable element.
	 */
	initialFocusSelector?: string;
}

const FOCUSABLE_SELECTOR =
	'button:not([disabled]):not([aria-hidden="true"]), ' +
	'[href]:not([aria-hidden="true"]), ' +
	'input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"]), ' +
	'select:not([disabled]):not([aria-hidden="true"]), ' +
	'textarea:not([disabled]):not([aria-hidden="true"]), ' +
	'[tabindex]:not([tabindex="-1"]):not([aria-hidden="true"])';

/**
 * Svelte action providing focus management, tab trapping, and escape handling
 * for custom accessible dialogs.
 *
 * Honors canonical canClose() guards to prevent unsafe closure during
 * pending mutations or irreversible forward recovery.
 */
export function dialogAccessibility(node: HTMLElement, options: DialogAccessibilityOptions) {
	const previousActiveElement =
		typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

	let currentOptions = options;

	const focusInitialElement = () => {
		if (currentOptions.initialFocusSelector) {
			const preferred = node.querySelector<HTMLElement>(currentOptions.initialFocusSelector);
			if (preferred && typeof preferred.focus === 'function') {
				preferred.focus();
				return;
			}
		}

		const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
			(el) => el.offsetParent !== null || el.getClientRects().length > 0
		);

		if (focusables.length > 0 && typeof focusables[0]?.focus === 'function') {
			focusables[0].focus();
		} else if (typeof node.focus === 'function') {
			if (!node.hasAttribute('tabindex')) {
				node.setAttribute('tabindex', '-1');
			}
			node.focus();
		}
	};

	if (typeof queueMicrotask === 'function') {
		queueMicrotask(focusInitialElement);
	} else {
		setTimeout(focusInitialElement, 0);
	}

	const handleWindowKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			if (currentOptions.canClose()) {
				currentOptions.onClose();
			}
			return;
		}

		if (event.key === 'Tab') {
			const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
				(el) => el.offsetParent !== null || el.getClientRects().length > 0
			);

			if (focusables.length === 0) {
				event.preventDefault();
				return;
			}

			const first = focusables[0];
			const last = focusables[focusables.length - 1];

			if (event.shiftKey) {
				if (document.activeElement === first || !node.contains(document.activeElement)) {
					event.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last || !node.contains(document.activeElement)) {
					event.preventDefault();
					first.focus();
				}
			}
		}
	};

	if (typeof window !== 'undefined') {
		window.addEventListener('keydown', handleWindowKeydown, true);
	}

	return {
		update(newOptions: DialogAccessibilityOptions) {
			currentOptions = newOptions;
		},
		destroy() {
			if (typeof window !== 'undefined') {
				window.removeEventListener('keydown', handleWindowKeydown, true);
			}

			if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
				try {
					if (document.body.contains(previousActiveElement)) {
						previousActiveElement.focus();
					}
				} catch {
					// Ignore if element is no longer focusable
				}
			}
		}
	};
}
