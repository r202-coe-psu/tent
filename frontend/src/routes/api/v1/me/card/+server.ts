import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readSessionUserCtx, serviceError, ServiceError } from '$lib/server/couch-admin';
import { PublicScheduleError } from '$lib/features/volunteers/server/public-schedule-action';
import { getMyCard } from '$lib/server/staff-card-service';

export const prerender = false;

/** GET — the caller's own permanent QR card (staff or volunteer) */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const { name } = await readSessionUserCtx(request.headers.get('cookie'));
		if (!name) throw new ServiceError('UNAUTHENTICATED', 'Authentication required');

		const card = await getMyCard(name).catch((e: unknown) => {
			if (e instanceof PublicScheduleError) {
				throw new ServiceError('INTERNAL', 'ออกบัตรจิตอาสาไม่สำเร็จ กรุณาลองใหม่');
			}
			throw e;
		});
		return json(card, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		return serviceError(e);
	}
};
