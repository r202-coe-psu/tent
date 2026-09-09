import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter
} from '$lib/server/security/rate-limiter';
import {
	preflightPublicVolunteerApplication,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

export const prerender = false;

const schema = z.object({
	job_id: z.string().min(1),
	shelter_code: z.string().trim().min(1).optional(),
	first_name: z.string().trim().min(1),
	last_name: z.string().trim().min(1),
	phone: z
		.string()
		.trim()
		.transform((value) => value.replace(/\D/g, ''))
		.pipe(z.string().regex(/^0\d{8,9}$/, 'เบอร์โทรศัพท์ไม่ถูกต้อง')),
	email: z.string().optional(),
	skills: z.array(z.string().trim().min(1)).default([]),
	shift_id: z.string().trim().min(1).optional(),
	shift_date: z.string().optional(),
	start_time: z.string().optional(),
	end_time: z.string().optional(),
	station: z.string().optional()
});

const noStore = { 'Cache-Control': 'no-store' };

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json(
			{ success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message },
			{ status: 400, headers: noStore }
		);
	}
	const ip = getClientAddress();
	if (!volunteerApplyIpLimiter.check(ip) || !volunteerApplyPhoneLimiter.check(parsed.data.phone)) {
		return json(
			{ success: false, error: 'RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง' },
			{ status: 429, headers: noStore }
		);
	}
	try {
		const result = await preflightPublicVolunteerApplication(parsed.data.job_id, {
			shelter_code: parsed.data.shelter_code,
			first_name: parsed.data.first_name,
			last_name: parsed.data.last_name,
			phone: parsed.data.phone,
			email: parsed.data.email ?? '',
			skills: parsed.data.skills,
			shift_id: parsed.data.shift_id,
			shift_date: parsed.data.shift_date,
			start_time: parsed.data.start_time,
			end_time: parsed.data.end_time,
			station: parsed.data.station
		});
		return json({ success: true, ...result }, { status: 200, headers: noStore });
	} catch (error) {
		if (error instanceof PublicApplicationError) {
			return json(
				{ success: false, error: error.code },
				{ status: error.httpStatus, headers: noStore }
			);
		}
		return json({ success: false, error: 'PREFLIGHT_FAILED' }, { status: 503, headers: noStore });
	}
};
