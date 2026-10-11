import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearRecaptchaStatusCache, fetchRecaptchaEnabled } from './recaptcha-status';

function answer(enabled: unknown, ok = true) {
	return { ok, json: async () => ({ enabled }) } as unknown as Response;
}

describe('fetchRecaptchaEnabled', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		clearRecaptchaStatusCache();
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('does not cache a failed fetch — the next call asks again', async () => {
		fetchMock.mockRejectedValueOnce(new Error('network down'));
		expect(await fetchRecaptchaEnabled()).toBe(false);

		fetchMock.mockResolvedValueOnce(answer(true));
		expect(await fetchRecaptchaEnabled()).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does not cache a non-2xx answer', async () => {
		fetchMock.mockResolvedValueOnce(answer(true, false));
		expect(await fetchRecaptchaEnabled()).toBe(false);

		fetchMock.mockResolvedValueOnce(answer(true));
		expect(await fetchRecaptchaEnabled()).toBe(true);
	});

	it('does not cache false — turning the flag on mid-session is picked up', async () => {
		fetchMock.mockResolvedValueOnce(answer(false));
		expect(await fetchRecaptchaEnabled()).toBe(false);

		fetchMock.mockResolvedValueOnce(answer(true));
		expect(await fetchRecaptchaEnabled()).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('reuses a confirmed true without another request', async () => {
		fetchMock.mockResolvedValueOnce(answer(true));
		expect(await fetchRecaptchaEnabled()).toBe(true);
		expect(await fetchRecaptchaEnabled()).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('treats anything but enabled === true as off', async () => {
		fetchMock.mockResolvedValueOnce(answer('yes'));
		expect(await fetchRecaptchaEnabled()).toBe(false);
	});

	it('coalesces simultaneous callers into one request', async () => {
		fetchMock.mockResolvedValue(answer(true));
		const results = await Promise.all([fetchRecaptchaEnabled(), fetchRecaptchaEnabled()]);
		expect(results).toEqual([true, true]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('clearRecaptchaStatusCache forgets a cached true', async () => {
		fetchMock.mockResolvedValue(answer(true));
		await fetchRecaptchaEnabled();
		clearRecaptchaStatusCache();
		await fetchRecaptchaEnabled();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
