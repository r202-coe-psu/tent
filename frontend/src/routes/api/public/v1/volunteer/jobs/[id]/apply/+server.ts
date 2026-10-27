import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { volunteerApplySchema } from '$lib/features/volunteer-portal/server';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { verifyRecaptchaOrSkip } from '$lib/server/security/recaptcha-gate';
import {
	applyPublicVolunteerApplicationToShifts,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

export const prerender = false;

const captchaProvider = new ReCaptchaProvider(
	env.RECAPTCHA_PROJECT_ID || env.SECRET_RECAPTCHA_KEY || 'smart-shelter-508719'
);
const noStore = { 'Cache-Control': 'no-store' };

/**
 * สมัครงานอาสาแบบไม่ต้องล็อกอิน (CR-092 FR-VOL-02 / AC-VOL-02).
 *
 * No account and no SMS OTP, so spam control is the whole guard: reCAPTCHA Enterprise here,
 * and request rate limiting at nginx.
 *
 * CAPTCHA verification uses the shared gate, so the project ID + service-account
 * deployment configuration, operator kill-switch, and production fail-closed behavior
 * match the login and other public BFF routes.
 *
 * The quota move, ticket mint, auto-accept decision and persistence happen through
 * the public CouchDB writer. The captcha token is consumed here and never sent on.
 *
 * One request may carry several shifts of the job (`shifts[]`, #716) and still counts as
 * one attempt. Every shift becomes its own application and gets its own entry in
 * `results[]`; the shifts that passed are saved even when others did not. A request where
 * no shift passed answers with the first shift's error, so a single-shift client sees
 * exactly what it saw before.
 */
export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	const payload = await request.json().catch(() => null);
	const parsed = volunteerApplySchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}
	const { captchaToken, shifts, ...application } = parsed.data;

	const ip = getClientAddress();

	const captcha = await verifyRecaptchaOrSkip({
		token: captchaToken ?? '',
		ip,
		action: 'volunteer_apply',
		provider: captchaProvider
	});
	if (!captcha.ok) {
		return json(
			{ success: false, error: captcha.error },
			{ status: captcha.status, headers: noStore }
		);
	}

	try {
		const { job_id, volunteer_token, results } = await applyPublicVolunteerApplicationToShifts(
			params.id,
			application,
			shifts ?? [{ shift_id: application.shift_id, shift_date: application.shift_date }]
		);
		const firstSaved = results.find((result) => result.ok);
		if (!firstSaved) {
			const firstFailed = results.find((result) => !result.ok);
			return json(
				{ success: false, error: firstFailed?.error ?? 'APPLY_FAILED', results },
				{ status: firstFailed?.http_status ?? 503, headers: noStore }
			);
		}
		return json(
			{
				success: true,
				// The first saved shift at the top level, for clients that read one ticket.
				tracking_token: firstSaved.tracking_token,
				status: firstSaved.status,
				job_id,
				shift_id: firstSaved.shift_id,
				...(volunteer_token ? { volunteer_token } : {}),
				results
			},
			{ status: 201, headers: noStore }
		);
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
