/**
 * Shelter close (CR-219).
 *
 * GET  /api/back-office/shelter/[code]/close — FR-7 preview: people the close would change,
 *      by stay status (live read, no cache).
 * POST /api/back-office/shelter/[code]/close — FR-8..FR-14: re-check `confirm_text`, check out /
 *      cancel everyone still on a stay, re-count, and only when nothing failed and nothing is
 *      left write registry `operation_status = closed` (+ `closed_at` via `updateMaster`).
 *
 * Both require SA or the shelter manager of this shelter (FR-22, D-6).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	requireShelterManagerOrSA,
	serviceOrHttpError,
	ServiceError
} from '$lib/server/couch-admin';
import { findMasterByCode, migrate, nowIso, updateMaster } from '$lib/server/shelters.admin';
import { closeShelterPeople, previewShelterClose } from '$lib/server/shelter-close';
import type { CouchReq } from '$lib/server/ensure-public-writer';
import {
	matchesShelterCloseConfirm,
	resolveOperationStatus,
	shelterCloseRequestSchema,
	type ShelterCloseResult
} from '$lib/features/shelters/server';

export const prerender = false;

const couchReq: CouchReq = (method, path, body) => adminRaw(path, method, body);

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
		return json(await previewShelterClose(couchReq, code), {
			headers: { 'cache-control': 'no-store' }
		});
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
		// FR-8: never trust the client's modal — re-check the typed phrase here.
		if (!matchesShelterCloseConfirm(body.data.confirm_text, shelter.code, shelter.name)) {
			error(400, { message: 'ข้อความยืนยันไม่ตรงกับรหัสและชื่อศูนย์' });
		}

		const run = await closeShelterPeople(couchReq, shelter.code, { createdBy: caller.name });

		// FR-13: close the registry only when every stay was closed out.
		const closed = run.failed.length === 0 && run.remaining.total === 0;
		// A repeat close of an already-closed shelter leaves the registry alone — rewriting it
		// would only bump `_rev` and make the worker re-project an unchanged shelter.
		if (closed && resolveOperationStatus(shelter) !== 'closed') {
			await updateMaster(shelter.code, () => ({
				patch: { operation_status: 'closed', updated_at: nowIso() }
			}));
		}

		const result: ShelterCloseResult = {
			closed,
			checked_out: run.checked_out,
			cancelled: run.cancelled,
			failed: run.failed
		};
		return json(result);
	} catch (e) {
		return serviceOrHttpError(e);
	}
};
