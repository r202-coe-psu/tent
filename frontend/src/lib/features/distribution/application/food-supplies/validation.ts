import { parseQty } from '$lib/utils/qty';
import { WorkflowValidationError } from './errors';

/** Enforces the shared Application contract for a quantity supplied as a positive decimal string. */
export function assertPositiveQty(value: string, fieldName: string, context?: string): void {
	const qty = parseQty(value);
	if (qty.isNegative() || qty.isZero()) {
		throw new WorkflowValidationError(
			`${fieldName} must be a positive decimal string${context ? ` ${context}` : ''}`
		);
	}
}
