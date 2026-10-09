/**
 * Focus helpers for "jump to the first invalid field" in the unified registration form.
 *
 * A field is flagged with `aria-invalid="true"`; for composite controls (a radio group) that
 * marker sits on a non-focusable wrapper, so the jump has to find the control inside.
 */

const INVALID_SELECTOR = '[aria-invalid="true"]';

const NATIVE_FOCUSABLE = 'input, select, textarea, button, a[href], summary';
const INNER_FOCUSABLE =
	'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [role="radio"]:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isDisabled(el: HTMLElement): boolean {
	return (
		el.matches(':disabled') ||
		el.getAttribute('aria-disabled') === 'true' ||
		el.hasAttribute('inert')
	);
}

/** First field flagged `aria-invalid="true"` in DOM order, skipping disabled controls. */
export function firstInvalidField(root: ParentNode | null | undefined): HTMLElement | null {
	if (!root) return null;
	for (const el of root.querySelectorAll<HTMLElement>(INVALID_SELECTOR)) {
		if (!isDisabled(el)) return el;
	}
	return null;
}

/** The element that should take keyboard focus for an invalid field. */
export function focusTargetFor(field: HTMLElement): HTMLElement {
	if (field.matches(NATIVE_FOCUSABLE) || field.hasAttribute('tabindex')) return field;
	return field.querySelector<HTMLElement>(INNER_FOCUSABLE) ?? field;
}
