import fs from 'node:fs';
import path from 'node:path';
import { RecaptchaEnterpriseServiceClient } from '@google-cloud/recaptcha-enterprise';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export interface CaptchaProvider {
	verifyToken(token: string, ip?: string, expectedAction?: string): Promise<boolean>;
}

export interface ReCaptchaEnterpriseOptions {
	projectId?: string;
	siteKey?: string;
	keyFilename?: string;
}

function resolveCredentialsFile(explicitPath?: string): string | undefined {
	if (explicitPath && fs.existsSync(explicitPath)) {
		return path.resolve(explicitPath);
	}
	const envCred = process.env.GOOGLE_APPLICATION_CREDENTIALS || env.GOOGLE_APPLICATION_CREDENTIALS;
	if (envCred) {
		if (fs.existsSync(envCred)) return path.resolve(envCred);
		const rel = path.resolve(process.cwd(), envCred);
		if (fs.existsSync(rel)) return rel;
	}
	const candidates = [
		path.resolve(process.cwd(), 'secrets/gcp-recaptcha-key.json'),
		path.resolve(process.cwd(), '../secrets/gcp-recaptcha-key.json'),
		'/app/secrets/gcp-recaptcha-key.json'
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return undefined;
}

export class ReCaptchaEnterpriseProvider implements CaptchaProvider {
	private projectId: string;
	private siteKey: string;
	private keyFilename?: string;
	private client: RecaptchaEnterpriseServiceClient | null = null;

	constructor(
		options?: string | ReCaptchaEnterpriseOptions,
		injectedClient?: RecaptchaEnterpriseServiceClient
	) {
		if (typeof options === 'string') {
			this.projectId = options || env.RECAPTCHA_PROJECT_ID || 'smart-shelter-508719';
			this.siteKey = publicEnv.PUBLIC_RECAPTCHA_SITE_KEY || '';
		} else {
			this.projectId = options?.projectId || env.RECAPTCHA_PROJECT_ID || 'smart-shelter-508719';
			this.siteKey = options?.siteKey || publicEnv.PUBLIC_RECAPTCHA_SITE_KEY || '';
			this.keyFilename = options?.keyFilename;
		}
		if (injectedClient) {
			this.client = injectedClient;
		}
	}

	private getClient(): RecaptchaEnterpriseServiceClient {
		if (!this.client) {
			const credFile = resolveCredentialsFile(this.keyFilename);
			this.client = new RecaptchaEnterpriseServiceClient(
				credFile
					? { keyFilename: credFile, projectId: this.projectId }
					: { projectId: this.projectId }
			);
		}
		return this.client;
	}

	async verifyToken(token: string, _ip?: string, expectedAction?: string): Promise<boolean> {
		if (!token) return false;

		try {
			const client = this.getClient();
			const projectPath = client.projectPath(this.projectId);

			const request = {
				assessment: {
					event: {
						token,
						siteKey: this.siteKey
					}
				},
				parent: projectPath
			};

			const [response] = await client.createAssessment(request);

			if (!response.tokenProperties?.valid) {
				console.warn(
					`[reCAPTCHA Enterprise] Token invalid: ${response.tokenProperties?.invalidReason}`
				);
				return false;
			}

			if (expectedAction && response.tokenProperties?.action !== expectedAction) {
				console.warn(
					`[reCAPTCHA Enterprise] Action mismatch: expected '${expectedAction}', got '${response.tokenProperties?.action}'`
				);
				return false;
			}

			const score = response.riskAnalysis?.score ?? 0;
			if (score < 0.5) {
				console.warn(
					`[reCAPTCHA Enterprise] Score too low: ${score} (reasons: ${response.riskAnalysis?.reasons?.join(', ')})`
				);
				return false;
			}

			return true;
		} catch (err) {
			console.error('[reCAPTCHA Enterprise] Assessment failed:', err);
			return false;
		}
	}
}

// Backward compatibility alias
export const ReCaptchaProvider = ReCaptchaEnterpriseProvider;
