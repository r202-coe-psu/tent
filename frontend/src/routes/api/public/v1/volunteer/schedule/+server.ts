import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portalCredentialSchema } from '$lib/features/volunteer-portal/server';
import {
	PublicScheduleError,
	readPublicVolunteerSchedule
} from '$lib/features/volunteers/server/public-schedule-action';

/**
 * ตารางทำงานจิตอาสา — the Access Portal's schedule (CR-092 หน้าจอ 6).
 *
 * Takes either sign-in credential — the phone the volunteer applied with, or the ticket
 * token behind the QR on their pass (CR-092 หน้าจอ 6). Both resolve to the same
 * `phone_hash` upstream, so the roster does not depend on which door they came through.
 *
 * Read-only. Accepting or declining a dispatched shift is a separate write path and is
 * not reachable from here.
 */
export const POST: RequestHandler = async ({ request }) => {
	// A body that is not JSON is INVALID_INPUT, not a 503.
	const body: unknown = await request.json().catch(() => null);
	const parsed = portalCredentialSchema.safeParse(body);
	try {
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		return json(await readPublicVolunteerSchedule(parsed.data), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		if (error instanceof PublicScheduleError) {
			return json({ success: false, error: error.code }, { status: error.httpStatus });
		}
		return json({ success: false, error: 'SCHEDULE_UNAVAILABLE' }, { status: 503 });
	}
};
