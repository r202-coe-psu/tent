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
	selected_shift: z
		.object({
			shift_id: z.string().trim().min(1).optional(),
			date: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)')
				.optional(),
			start_time: z.string().min(1).optional(),
			end_time: z.string().min(1).optional()
		})
		.optional(),
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
			shift_id: selected_shift?.shift_id,
			shift_date: selected_shift?.date,
			start_time: selected_shift?.start_time,
			end_time: selected_shift?.end_time,
			station: undefined
		});
		return json({ success: true, ...result }, { status: 201, headers: noStore });
	} catch (error) {
		if (error instanceof PublicApplicationError) {
			const errorMessages: Record<string, string> = {
				JOB_NOT_FOUND: 'ไม่พบงานที่ระบุในระบบ',
				JOB_NOT_OPEN: 'งานนี้ปิดรับสมัครแล้ว',
				JOB_FULL: 'งานนี้มีผู้สมัครเต็มจำนวนแล้ว',
				SHIFT_NOT_FOUND: 'ไม่พบกะเวลาที่เลือก',
				SHIFT_FULL: 'กะเวลานี้มีผู้สมัครเต็มจำนวนแล้ว',
				SHIFT_ID_REQUIRED: 'กรุณาเลือกกะเวลาที่ต้องการปฏิบัติงาน',
				SHIFT_DATE_AMBIGUOUS: 'มีกะเวลาซ้ำกันในวันที่เลือก กรุณาระบุกะเวลาให้ชัดเจน',
				DUPLICATE_APPLICATION: 'คุณได้สมัครงานนี้ไว้แล้ว',
				TIME_CONFLICT: 'คุณมีกะงานอื่นที่เวลาทับซ้อนกัน',
				JOB_NOT_READY: 'ระบบกำลังปรับปรุงข้อมูล กรุณาลองใหม่อีกครั้ง',
				WRITE_FAILED: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง'
			};
			return json(
				{
					success: false,
					error: error.code,
					message: errorMessages[error.code] || error.message
				},
				{ status: error.httpStatus, headers: noStore }
			);
		}
		console.error('[public-volunteer-apply] direct CouchDB write failed', error);
		return json(
			{ success: false, error: 'APPLY_FAILED', message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' },
			{ status: 503, headers: noStore }
		);
	}
};
