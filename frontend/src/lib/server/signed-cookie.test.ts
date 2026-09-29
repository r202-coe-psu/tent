import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { EXTERNAL_API_SECRET: 'test-secret' } }));

import { signPayload, verifyPayload } from './signed-cookie';

describe('signed-cookie (CR-141)', () => {
	it('round-trips a payload with an embedded expiry', () => {
		const token = signPayload('p', { a: 1 }, 60);
		const data = verifyPayload<{ a: number }>('p', token);
		expect(data?.a).toBe(1);
		expect(typeof data?.exp).toBe('number');
	});

	it('rejects a tampered payload or signature', () => {
		const token = signPayload('p', { a: 1 }, 60);
		const [payload, sig] = token.split('.');
		const forged = Buffer.from(JSON.stringify({ a: 2, exp: 9e9 })).toString('base64url');
		expect(verifyPayload('p', `${forged}.${sig}`)).toBeNull();
		expect(verifyPayload('p', `${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
	});

	it('rejects a token signed for another prefix', () => {
		expect(verifyPayload('other', signPayload('p', { a: 1 }, 60))).toBeNull();
	});

	it('rejects an expired token', () => {
		const token = signPayload('p', { a: 1 }, 60);
		const later = Math.floor(Date.now() / 1000) + 61;
		expect(verifyPayload('p', token, later)).toBeNull();
	});

	it('rejects missing / malformed input', () => {
		expect(verifyPayload('p', undefined)).toBeNull();
		expect(verifyPayload('p', 'no-dot')).toBeNull();
		expect(verifyPayload('p', '.sig')).toBeNull();
	});
});
