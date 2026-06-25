export interface CaptchaProvider {
	verifyToken(token: string, ip?: string): Promise<boolean>;
}

export class ReCaptchaProvider implements CaptchaProvider {
	private secretKey: string;

	constructor(secretKey: string) {
		this.secretKey = secretKey;
	}

	async verifyToken(token: string, ip?: string): Promise<boolean> {
		if (!token) return false;
		
		try {
			const params = new URLSearchParams();
			params.append('secret', this.secretKey);
			params.append('response', token);
			if (ip) {
				params.append('remoteip', ip);
			}

			const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: params.toString()
			});

			const data = await res.json();
			return data.success === true;
		} catch (err) {
			console.error('ReCaptcha verification failed:', err);
			return false;
		}
	}
}
