/**
 * Shelter close (CR-219 preview + CR-243 durable job).
 *
 * GET  /api/back-office/shelter/[code]/close — FR-7 preview (live read, no cache) plus
 *      `active_job` while a close job is queued / running (CR-243 FR-5).
 * POST /api/back-office/shelter/[code]/close — re-check `confirm_text` (CR-219 FR-8), then create
 *      the close job + lock and answer `202 { job_id }` without touching anyone in the shelter
 *      (CR-243 FR-6); a job already active -> `409 { job_id }` (FR-7). `shelter-close-worker`
 *      does the work through `/api/internal/shelter-close/worker/next`.
 *
 * Both require SA or the shelter manager of this shelter (CR-219 FR-22, D-6).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	requireShelterManagerOrSA,
	serviceOrHttpError,
	ServiceError
} from '$lib/server/couch-admin';
import { findMasterByCode, migrate } from '$lib/server/shelters.admin';
import { previewShelterClose } from '$lib/server/shelter-close';
import { adminCouchReq, getShelterCloseStore } from '$lib/server/shelter-close-job-runtime';
import {
	matchesShelterCloseConfirm,
	shelterCloseRequestSchema
} from '$lib/features/shelters/server';

export const prerender = false;

async function requireShelter(code: string) {
	const master = await findMasterByCode(code);
	if (!master) throw new ServiceError('NOT_FOUND', `Shelter "${code}" not found`);
	return migrate(master);
}

export const GET: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	if (!code) return error(400, { message: 'Missing code' });
	try {
		await requireShelterManagerOrSA(request.headers.get('cookie'), code);
		await requireShelter(code);
		const preview = await previewShelterClose(adminCouchReq, code);
		const active = await getShelterCloseStore().getActiveJob(code);
		return json(
			{
				...preview,
				...(active ? { active_job: { job_id: active.job_ulid, status: active.status } } : {})
			},
			{ headers: { 'cache-control': 'no-store' } }
		);
	} catch (e) {
		return serviceOrHttpError(e);
	}
};

export const POST: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	if (!code) return error(400, { message: 'Missing code' });
	try {
		const caller = await requireShelterManagerOrSA(request.headers.get('cookie'), code);
		const body = shelterCloseRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) error(400, { message: 'confirm_text is required' });

		const shelter = await requireShelter(code);
		// CR-252: External shelters have no stays/occupancy; closing would hide them wrongly.
		if (shelter.is_external) error(409, { message: 'ศูนย์จากระบบภายนอกปิดศูนย์ไม่ได้' });
		// CR-219 FR-8: never trust the client's modal — re-check the typed phrase here.
		if (!matchesShelterCloseConfirm(body.data.confirm_text, shelter.code, shelter.name)) {
			error(400, { message: 'ข้อความยืนยันไม่ตรงกับรหัสและชื่อศูนย์' });
		}

		const preview = await previewShelterClose(adminCouchReq, shelter.code);
		const result = await getShelterCloseStore().createJob({
			shelter_code: shelter.code,
			mode: 'close',
			// FR-10: the requester comes from the session, never the body.
			requested_by: caller.name,
			preview
		});
		if (!result.created) {
			return json(
				{ job_id: result.job_id, message: 'กำลังปิดศูนย์อยู่แล้ว' },
				{ status: 409, headers: { 'cache-control': 'no-store' } }
			);
		}
		return json(
			{ job_id: result.job.job_ulid },
			{ status: 202, headers: { 'cache-control': 'no-store' } }
		);
	} catch (e) {
		return serviceOrHttpError(e);
	}
};
