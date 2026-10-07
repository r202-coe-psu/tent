import { WorkflowValidationError } from './errors';

const POSITIVE_INT_RE = /^0*[1-9]\d*$/;

export function isPositiveIntegerQty(value: string | number): boolean {
	return POSITIVE_INT_RE.test(String(value).trim());
}

/** Enforces that a quantity is a positive whole number (for countable item quantities). */
export function assertPositiveIntegerQty(
	value: string | number,
	fieldName: string,
	context?: string
): void {
	const trimmed = String(value).trim();
	if (!POSITIVE_INT_RE.test(trimmed)) {
		throw new WorkflowValidationError(
			`${fieldName} must be a positive whole number${context ? ` ${context}` : ''}`
		);
	}
}
