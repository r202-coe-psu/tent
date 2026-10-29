import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelTicket, TicketCancelError } from '$lib/features/volunteers/server/public-ticket';

/** "ขอยกเลิกการสมัครล่วงหน้า" on the pass (CR-092 FR-VOL-03.3). */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = (await request.json().catch(() => null)) as { application_id?: unknown } | null;
		const applicationId = typeof body?.application_id === 'string' ? body.application_id : '';
		await cancelTicket(params.token.trim(), applicationId);
		return json({ success: true, message: 'Application cancelled' });
	} catch (err) {
		if (err instanceof TicketCancelError) {
			return json({ success: false, error: err.code }, { status: err.httpStatus });
		}
		return json({ success: false, error: 'CANCEL_FAILED' }, { status: 503 });
	}
};
