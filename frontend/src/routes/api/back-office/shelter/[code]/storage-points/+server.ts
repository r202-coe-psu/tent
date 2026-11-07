import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceOrHttpError } from '$lib/server/couch-admin';
import {
	addStoragePoint,
	readStoragePoints,
	requireStoragePointManager,
	storagePointBodySchema,
	validationError
} from '$lib/server/storage-points';

export const prerender = false;

/** The shelter's storage points and the `_rev` the next write must quote (#1186). */
export const GET: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	if (!code) return error(400, { message: 'Missing code' });
	try {
		await requireStoragePointManager(request.headers.get('cookie'), code);
		return json(await readStoragePoints(code));
	} catch (e) {
		return serviceOrHttpError(e);
	}
};

/** Add a point; the server issues its ULID `id`. Touches `common_areas.sub_storage` only. */
export const POST: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	if (!code) return error(400, { message: 'Missing code' });
	try {
		await requireStoragePointManager(request.headers.get('cookie'), code);
		const body = storagePointBodySchema.parse(await request.json().catch(() => ({})));
		const written = await addStoragePoint(code, body._rev, body.point);
		return json({ ok: true, ...written }, { status: 201 });
	} catch (e) {
		return serviceOrHttpError(validationError(e));
	}
};
