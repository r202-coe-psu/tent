import { json } from '@sveltejs/kit';
import { donationPreDeclarationInputSchema } from '$lib/features/donations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { otpStore } from '$lib/server/security/otp-store';

export const POST = async ({ request, getClientAddress }) => {
	try {
		const payload = await request.json();

		// 1. Validate schema (which includes otpToken)
		const parsed = donationPreDeclarationInputSchema.safeParse(payload);
		if (!parsed.success) {
			return json({ success: false, error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
		}

		// 2. Rate Limiting Check
		const ip = getClientAddress();
		const phone = parsed.data.phone;

		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'You are making too many requests from this IP. Please wait a minute.' }, { status: 429 });
		}

		if (!donationPhoneLimiter.check(phone)) {
			return json({ success: false, error: 'You are making too many requests with this phone number. Please wait a minute.' }, { status: 429 });
		}

		// 3. OTP Verification
		const isValidOtp = otpStore.verify(phone, parsed.data.otpToken);
		if (!isValidOtp) {
			return json({ success: false, error: 'รหัส OTP ไม่ถูกต้อง หรือหมดอายุ กรุณาขอรหัสใหม่' }, { status: 403 });
		}

		// 4. Save to database (mocked for now, returning success)
		// await donationRepository.save(parsed.data);

		return json({ success: true, trackingToken: 'TX-DON-' + Math.random().toString(36).substring(2, 6).toUpperCase() });
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
