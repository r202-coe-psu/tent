import { describe, expect, it } from 'vitest';
import { isDependencyUnreachable } from './dependency-unreachable';

function fetchFailed(code: string): TypeError {
	return new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code }) });
}

describe('isDependencyUnreachable', () => {
	it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])(
		'recognises a failed fetch caused by %s',
		(code) => {
			expect(isDependencyUnreachable(fetchFailed(code))).toBe(true);
		}
	);

	it('recognises a bare "fetch failed" TypeError without a cause', () => {
		expect(isDependencyUnreachable(new TypeError('fetch failed'))).toBe(true);
	});

	it('recognises an AbortSignal.timeout error', () => {
		const timeout = new Error('The operation was aborted due to timeout');
		timeout.name = 'TimeoutError';
		expect(isDependencyUnreachable(timeout)).toBe(true);
	});

	it.each([
		new Error('boom'),
		new TypeError('x is not a function'),
		Object.assign(new Error('x'), { code: 'EACCES' }),
		'ECONNREFUSED',
		null,
		undefined
	])('does not treat %s as unreachable', (error) => {
		expect(isDependencyUnreachable(error)).toBe(false);
	});
});
