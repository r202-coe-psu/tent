import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReCaptchaProvider } from './captcha';

describe('ReCaptchaProvider', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	it('should return true for valid tokens', async () => {
		fetchMock.mockResolvedValue({
			json: () => Promise.resolve({ success: true })
		});

		const provider = new ReCaptchaProvider('dummy-secret');
		const result = await provider.verifyToken('valid-token', '127.0.0.1');

		expect(result).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const callArgs = fetchMock.mock.calls[0];
		expect(callArgs[0]).toBe('https://www.google.com/recaptcha/api/siteverify');
		expect(callArgs[1].body.toString()).toContain('response=valid-token');
	});

	it('should return false for missing or empty tokens', async () => {
		const provider = new ReCaptchaProvider('dummy-secret');
		const result = await provider.verifyToken('');

		expect(result).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('should return false if google verification fails', async () => {
		fetchMock.mockResolvedValue({
			json: () => Promise.resolve({ success: false, 'error-codes': ['invalid-input-response'] })
		});

		const provider = new ReCaptchaProvider('dummy-secret');
		const result = await provider.verifyToken('invalid-token');

		expect(result).toBe(false);
	});

	it('should handle fetch errors gracefully and return false', async () => {
		fetchMock.mockRejectedValue(new Error('Network error'));

		const provider = new ReCaptchaProvider('dummy-secret');
		const result = await provider.verifyToken('valid-token');

		expect(result).toBe(false);
	});
});
