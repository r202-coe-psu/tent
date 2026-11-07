import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceOrHttpError } from '$lib/server/couch-admin';
import {
	editStoragePoint,
	removeStoragePoint,
	requireStoragePointManager,
	storagePointBodySchema,
	storagePointDeleteBodySchema,
	validationError
} from '$lib/server/storage-points';

export const prerender = false;

/** Edit one point. The `id` comes from the path; an `id` in the body is ignored. */
export const PATCH: RequestHandler = async ({ request, params }) => {
	const { code, pointId } = params;
	if (!code || !pointId) return error(400, { message: 'Missing code or pointId' });
	try {
		await requireStoragePointManager(request.headers.get('cookie'), code);
		const body = storagePointBodySchema.parse(await request.json().catch(() => ({})));
		const written = await editStoragePoint(code, pointId, body._rev, body.point);
		return json({ ok: true, ...written });
	} catch (e) {
		return serviceOrHttpError(validationError(e));
	}
};

/** Delete one point; 409 while a lot with qty > 0 still sits there or the `_rev` is stale. */
export const DELETE: RequestHandler = async ({ request, params }) => {
	const { code, pointId } = params;
	if (!code || !pointId) return error(400, { message: 'Missing code or pointId' });
	try {
		await requireStoragePointManager(request.headers.get('cookie'), code);
		const body = storagePointDeleteBodySchema.parse(await request.json().catch(() => ({})));
		return json({ ok: true, ...(await removeStoragePoint(code, pointId, body._rev)) });
	} catch (e) {
		return serviceOrHttpError(validationError(e));
	}
};
