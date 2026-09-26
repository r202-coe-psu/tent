import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecaptchaEnterpriseServiceClient } from '@google-cloud/recaptcha-enterprise';
import { ReCaptchaEnterpriseProvider } from './captcha';

describe('ReCaptchaEnterpriseProvider', () => {
	let mockCreateAssessment: ReturnType<typeof vi.fn>;
	let mockClient: RecaptchaEnterpriseServiceClient;

	beforeEach(() => {
		mockCreateAssessment = vi.fn();
		mockClient = {
			projectPath: vi.fn().mockReturnValue('projects/test-project'),
			createAssessment: mockCreateAssessment
		} as unknown as RecaptchaEnterpriseServiceClient;
	});

	it('should return true for valid token with matching action and high score', async () => {
		mockCreateAssessment.mockResolvedValue([
			{
				tokenProperties: { valid: true, action: 'register' },
				riskAnalysis: { score: 0.9, reasons: [] }
			}
		]);

		const provider = new ReCaptchaEnterpriseProvider(
			{ projectId: 'test-project', siteKey: 'test-site-key' },
			mockClient
		);
		const result = await provider.verifyToken('valid-token', '127.0.0.1', 'register');

		expect(result).toBe(true);
		expect(mockCreateAssessment).toHaveBeenCalledTimes(1);
		expect(mockCreateAssessment).toHaveBeenCalledWith({
			assessment: {
				event: {
					token: 'valid-token',
					siteKey: 'test-site-key'
				}
			},
			parent: 'projects/test-project'
		});
	});

	it('should return false for missing or empty tokens', async () => {
		const provider = new ReCaptchaEnterpriseProvider('test-project', mockClient);
		const result = await provider.verifyToken('');

		expect(result).toBe(false);
		expect(mockCreateAssessment).not.toHaveBeenCalled();
	});

	it('should return false if token is invalid according to Google', async () => {
		mockCreateAssessment.mockResolvedValue([
			{
				tokenProperties: { valid: false, invalidReason: 'EXPIRED' }
			}
		]);

		const provider = new ReCaptchaEnterpriseProvider('test-project', mockClient);
		const result = await provider.verifyToken('expired-token', '127.0.0.1', 'register');

		expect(result).toBe(false);
	});

	it('should return false if action does not match expectedAction', async () => {
		mockCreateAssessment.mockResolvedValue([
			{
				tokenProperties: { valid: true, action: 'wrong_action' },
				riskAnalysis: { score: 0.9 }
			}
		]);

		const provider = new ReCaptchaEnterpriseProvider('test-project', mockClient);
		const result = await provider.verifyToken('valid-token', '127.0.0.1', 'register');

		expect(result).toBe(false);
	});

	it('should return false if score is below 0.5', async () => {
		mockCreateAssessment.mockResolvedValue([
			{
				tokenProperties: { valid: true, action: 'register' },
				riskAnalysis: { score: 0.3, reasons: ['AUTOMATION'] }
			}
		]);

		const provider = new ReCaptchaEnterpriseProvider('test-project', mockClient);
		const result = await provider.verifyToken('valid-token', '127.0.0.1', 'register');

		expect(result).toBe(false);
	});

	it('should handle client errors gracefully and return false', async () => {
		mockCreateAssessment.mockRejectedValue(new Error('Network error'));

		const provider = new ReCaptchaEnterpriseProvider('test-project', mockClient);
		const result = await provider.verifyToken('valid-token', '127.0.0.1', 'register');

		expect(result).toBe(false);
	});
});
