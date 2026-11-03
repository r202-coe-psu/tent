import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portalCredentialSchema } from '$lib/features/volunteer-portal/server';
import { readPublicAccessStatus } from '$lib/features/volunteers/server/public-access-status';
import { PublicScheduleError } from '$lib/features/volunteers/server/public-schedule-action';

export const prerender = false;

/**
 * สิทธิ์ใช้งานระบบ of the signed-in volunteer, per shelter (CR-221 FR-26 to FR-28).
 *
 * Takes the same credential as `/volunteer/schedule` — the phone the volunteer applied with, or
 * the ticket token — and resolves it the same way. Read-only. The answer is status, role label
 * and end date per shelter; it never names the account, because anyone who knows a phone number
 * can ask.
 */
export const POST: RequestHandler = async ({ request }) => {
	// A body that is not JSON is INVALID_INPUT, not a 503.
	const body: unknown = await request.json().catch(() => null);
	const parsed = portalCredentialSchema.safeParse(body);
	try {
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		return json(await readPublicAccessStatus(parsed.data), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		if (error instanceof PublicScheduleError) {
			return json({ success: false, error: error.code }, { status: error.httpStatus });
		}
		return json({ success: false, error: 'ACCESS_STATUS_UNAVAILABLE' }, { status: 503 });
	}
};
