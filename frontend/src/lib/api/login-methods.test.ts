import { describe, expect, it, vi } from 'vitest';
import { fetchLoginMethods, parseLoginMethods } from './login-methods';

describe('login-methods client (CR-141)', () => {
	it('parses only strict true values', () => {
		expect(parseLoginMethods({ password: true, google: 'yes', thaid: 1 })).toEqual({
			password: true,
			google: false,
			thaid: false
		});
		expect(parseLoginMethods(null)).toEqual({ password: false, google: false, thaid: false });
	});

	it('fails closed when the BFF errors or is unreachable', async () => {
		const notOk = vi.fn(async () => new Response('x', { status: 500 }));
		expect(await fetchLoginMethods(notOk as unknown as typeof fetch)).toEqual({
			password: false,
			google: false,
			thaid: false
		});
		const throws = vi.fn(async () => {
			throw new Error('offline');
		});
		expect((await fetchLoginMethods(throws as unknown as typeof fetch)).password).toBe(false);
	});

	it('returns the server answer', async () => {
		const ok = vi.fn(async () => Response.json({ password: false, google: true, thaid: true }));
		expect(await fetchLoginMethods(ok as unknown as typeof fetch)).toEqual({
			password: false,
			google: true,
			thaid: true
		});
	});
});
