/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeTransfer, resolveShelterCode, handleEndpointError } from '../_auth';
import { TransferServerRepository } from '$lib/features/operations/data/transfer.server-repository';

export const prerender = false;

/**
 * GET /api/back-office/transfer/[id]
 * Fetch a single transfer document. Visible to source or destination shelter.
 */
export const GET: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeTransfer(request.headers.get('cookie'));
		const id = params.id;
		if (!id) {
			return json({ error: 'Missing ID parameter' }, { status: 400 });
		}

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const repo = new TransferServerRepository('central_ops', shelterCode);
		const doc = await repo.get(id);

		if (!doc) {
			return json({ error: `Transfer not found: ${id}` }, { status: 404 });
		}

		if (!caller.isSA && doc.from_shelter !== shelterCode && doc.to_shelter !== shelterCode) {
			return json({ error: 'Forbidden: You do not have access to this transfer' }, { status: 403 });
		}

		return json(doc);
	} catch (e: unknown) {
		return handleEndpointError(e, 'Transfer API ID GET');
	}
};

/**
 * DELETE /api/back-office/transfer/[id]
 * Hard-delete a transfer request (CR-090 FR-01–FR-03). Source shelter only, `requested` only —
 * both re-checked in the repository against the stored document, never taken from the client.
 *
 * Returns the deleted body and the tombstone revision so the caller can offer a 5-second undo
 * (FR-04/FR-09); the restore itself goes to `POST /api/back-office/transfer` (FR-05).
 */
export const DELETE: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeTransfer(request.headers.get('cookie'));
		const id = params.id;
		if (!id) {
			return json({ error: 'Missing ID parameter' }, { status: 400 });
		}

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const repo = new TransferServerRepository('central_ops', shelterCode);
		const removed = await repo.remove(id, shelterCode);

		return json({ ok: true, ...removed });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Transfer API ID DELETE');
	}
};
