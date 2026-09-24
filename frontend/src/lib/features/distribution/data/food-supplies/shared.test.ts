import { describe, expect, it } from 'vitest';
import { ConflictError } from '$lib/utils/errors';
import { MAX_CAS_RETRIES, retryCas } from './shared';

describe('Food/Supplies CAS retry', () => {
	it('retries a real typed ConflictError and lets the operation recompute', async () => {
		let attempts = 0;
		const result = await retryCas(async () => {
			attempts++;
			if (attempts === 1) throw new ConflictError('requisition_ticket:conflicted');
			return `recomputed-attempt-${attempts}`;
		});

		expect(result).toBe('recomputed-attempt-2');
		expect(attempts).toBe(2);
	});

	it.each([
		['a plain status 409 object', { status: 409 }],
		['a plain statusCode 409 object', { statusCode: 409 }],
		[
			'a name-only ConflictError',
			Object.assign(new Error('not the typed error'), { name: 'ConflictError' })
		],
		['a message-only 409 error', new Error('409 conflict')],
		['an ordinary error', new Error('network failure')]
	])('does not retry %s', async (_description, error) => {
		let attempts = 0;

		await expect(
			retryCas(async () => {
				attempts++;
				throw error;
			})
		).rejects.toBe(error);

		expect(attempts).toBe(1);
	});

	it('preserves bounded retry exhaustion for real typed conflicts', async () => {
		let attempts = 0;
		const conflict = new ConflictError('requisition_ticket:always-conflicted');

		await expect(
			retryCas(async () => {
				attempts++;
				throw conflict;
			})
		).rejects.toBe(conflict);

		expect(attempts).toBe(MAX_CAS_RETRIES);
	});
});
