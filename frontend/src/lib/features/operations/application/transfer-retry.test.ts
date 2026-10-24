import { describe, expect, it } from 'vitest';
import { shouldRetryQuery } from '$lib/auth/session-expiry';
import { TransferForbiddenError } from '../domain/operations';
import { retryUnlessForbidden } from './transfer-retry';

describe('retryUnlessForbidden (#571)', () => {
	it('never retries a refused transfer list', () => {
		expect(retryUnlessForbidden(0, new TransferForbiddenError())).toBe(false);
	});

	it('retries anything else as the app default does', () => {
		const err = new Error('Internal Server Error');
		expect(retryUnlessForbidden(0, err)).toBe(shouldRetryQuery(0, err));
		expect(retryUnlessForbidden(0, err)).toBe(true);
	});
});
