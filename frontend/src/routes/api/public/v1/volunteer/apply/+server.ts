import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import { isCaptchaKeyConfigured } from '$lib/features/public-register/server';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter
} from '$lib/server/security/rate-limiter';
import {
	applyPublicVolunteerApplication,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

export const prerender = false;

/** Compatibility payload for older clients that still post to this URL. */
const applySchema = z.object({
	job_id: z.string().min(1),
	shelter_code: z.string().trim().min(1).optional(),
	applicant: z.object({
		first_name: z.string().trim().min(1, 'กรุณาระบุชื่อ'),
		last_name: z.string().trim().min(1, 'กรุณาระบุนามสกุล'),
		phone: z
			.string()
			.trim()
			.min(1, 'กรุณาระบุเบอร์โทรศัพท์')
			.transform((value) => value.replace(/\D/g, ''))
			.pipe(z.string().regex(/^0\d{8,9}$/, 'เบอร์โทรศัพท์ไม่ถูกต้อง (เช่น 0812345678)')),
		email: z.string().email().nullable().optional(),
		skills: z.array(z.string().trim().min(1)).default([])
	}),
	selected_shift: z.object({
		shift_id: z.string().trim().min(1).optional(),
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)'),
		start_time: z.string().min(1),
		end_time: z.string().min(1)
	}),
	recaptcha_token: z.string().optional()
});

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');
const noStore = { 'Cache-Control': 'no-store' };

function normalizedJobId(value: string): string {
	return value.startsWith('job:') ? value : `job:${value}`;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const payload = await request.json().catch(() => null);
	const parsed = applySchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{
				success: false,
				error: 'VALIDATION_ERROR',
				message: parsed.error.issues[0]?.message || 'ข้อมูลไม่ถูกต้อง'
			},
			{ status: 400, headers: noStore }
		);
	}

	const { job_id, shelter_code, applicant, selected_shift, recaptcha_token } = parsed.data;
	const ip = getClientAddress();
	const captchaConfigured = isCaptchaKeyConfigured(env.SECRET_RECAPTCHA_KEY);
	const skipDevGuards = dev && !captchaConfigured;

	if (
		!skipDevGuards &&
		(!volunteerApplyIpLimiter.check(ip) || !volunteerApplyPhoneLimiter.check(applicant.phone))
	) {
		return json(
			{ success: false, error: 'RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง' },
			{ status: 429, headers: noStore }
		);
	}

	if (!captchaConfigured) {
		if (!dev) {
			console.error('SECRET_RECAPTCHA_KEY is missing or is a placeholder!');
			return json(
				{ success: false, error: 'SERVER_MISCONFIGURED' },
				{ status: 500, headers: noStore }
			);
		}
		console.warn('[dev] SECRET_RECAPTCHA_KEY not configured — skipping CAPTCHA verification');
	} else {
		if (!recaptcha_token) {
			return json({ success: false, error: 'CAPTCHA_REQUIRED' }, { status: 400, headers: noStore });
		}
		if (!(await captchaProvider.verifyToken(recaptcha_token, ip, 'volunteer_apply'))) {
			return json({ success: false, error: 'CAPTCHA_FAILED' }, { status: 403, headers: noStore });
		}
	}

	try {
		const result = await applyPublicVolunteerApplication(normalizedJobId(job_id), {
			shelter_code,
			first_name: applicant.first_name,
			last_name: applicant.last_name,
			phone: applicant.phone,
			email: applicant.email ?? '',
			skills: applicant.skills,
			shift_id: selected_shift.shift_id,
			shift_date: selected_shift.date,
			station: undefined
		});
		return json({ success: true, ...result }, { status: 201, headers: noStore });
	} catch (error) {
		if (error instanceof PublicApplicationError) {
			return json(
				{ success: false, error: error.code },
				{ status: error.httpStatus, headers: noStore }
			);
		}
		console.error('[public-volunteer-apply] direct CouchDB write failed', error);
		return json({ success: false, error: 'APPLY_FAILED' }, { status: 503, headers: noStore });
	}
};
