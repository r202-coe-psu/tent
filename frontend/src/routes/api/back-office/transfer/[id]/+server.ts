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
