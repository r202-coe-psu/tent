import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { RateLimiter } from '$lib/server/security/rate-limiter';
import { otpStore } from '$lib/server/security/otp-store';

const otpRateLimiter = new RateLimiter(60 * 1000, 3);
const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

export async function POST({ request, getClientAddress }) {
	try {
		const clientIp = getClientAddress();
		const body = await request.json();
		const { phone, captchaToken } = body;

		if (!phone) {
			return json({ success: false, error: 'กรุณาระบุเบอร์โทรศัพท์' }, { status: 400 });
		}

		if (!captchaToken) {
			return json({ success: false, error: 'กรุณายืนยันว่าคุณไม่ใช่บอท' }, { status: 400 });
		}

		// 1. Rate Limiting (by IP and Phone)
		if (!otpRateLimiter.check(clientIp) || !otpRateLimiter.check(phone)) {
			return json({ success: false, error: 'ส่งคำขอมากเกินไป กรุณารอ 1 นาที' }, { status: 429 });
		}

		// 2. CAPTCHA Verification
		// Bypass verification if we are using the dummy secret (for local development without real keys)
		if (env.SECRET_RECAPTCHA_KEY && env.SECRET_RECAPTCHA_KEY !== 'dummy-secret') {
			const isHuman = await captchaProvider.verifyToken(captchaToken, clientIp);
			if (!isHuman) {
				return json({ success: false, error: 'ยืนยันตัวตนไม่สำเร็จ (CAPTCHA ล้มเหลว)' }, { status: 403 });
			}
		}

		// 3. Generate and Store OTP
		otpStore.generateAndStore(phone);

		return json({ success: true, message: 'OTP sent' });
	} catch (err) {
		console.error('OTP API Error:', err);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
}
