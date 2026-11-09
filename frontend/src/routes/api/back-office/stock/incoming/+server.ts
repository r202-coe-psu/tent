/* eslint-disable no-restricted-imports */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeTransfer, handleEndpointError } from '../../transfer/_auth';
import { readIncomingStock } from '$lib/features/operations/data/incoming-stock.server';

export const prerender = false;

const SHELTER_CODE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * GET /api/back-office/stock/incoming?shelter_code=
 *
 * "Incoming stock" for the stock page (#1153): approved lines of open donation bookings and
 * `shipped` transfers addressed to the shelter, as base-unit rows plus the lines that cannot be
 * matched to a catalog item. Read-only; no donor PII in the response.
 *
 * Gate = the warehouse side of the shelter (`authorizeTransfer`: SA, shelter_manager,
 * warehouse_staff / supply_coordinator of the caller's own shelter) — deliberately NOT the
 * donation-staff gate, so whoever may read the stock page may read this. A non-SA caller may
 * only ask for their own shelter. SA may name any shelter, or omit `shelter_code` for all.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeTransfer(request.headers.get('cookie'));
		const param = url.searchParams.get('shelter_code')?.trim() || null;
		if (param && !SHELTER_CODE.test(param)) throw error(400, 'Invalid shelter_code');

		let shelterCode: string | null;
		if (caller.isSA) {
			shelterCode = param;
		} else {
			if (!caller.shelterCode) throw error(400, 'Missing shelter_code scope');
			if (param && param.toUpperCase() !== caller.shelterCode.toUpperCase()) {
				throw error(403, 'Caller is not in that shelter scope');
			}
			shelterCode = caller.shelterCode;
		}

		const { rows, unmatched } = await readIncomingStock(shelterCode);
		return json({ rows, unmatched });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Incoming stock API GET');
	}
};
