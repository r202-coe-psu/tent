import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import { isShelterCancelled } from '$lib/features/shelters/server';
import { authorizeTransfer, handleEndpointError, resolveShelterCode } from '../_auth';

export const prerender = false;

type RegistryRow = { doc?: Record<string, unknown> };

type TransferDestination = { code: string; name: string };

/**
 * GET /api/back-office/transfer/destinations
 * Shelters a transfer request may be sent to: every shelter except the caller's own (#570).
 *
 * The create-transfer form cannot use `listShelters()` for this — that list is scoped to the
 * caller's own shelter for everyone but system_admin, so after the form drops its own shelter
 * nothing is left. This route answers only code + name, to the same roles the transfer API
 * already accepts (`authorizeTransfer`). A cancelled shelter (set up by
 * mistake, never opened) is left out: nothing should be sent there.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeTransfer(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const own = resolveShelterCode(caller, url.searchParams.get('shelter_code')).toUpperCase();

		const res = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
		if (res.status >= 400) {
			return json({ error: 'Could not read the shelter registry' }, { status: 502 });
		}
		const rows = (res.data as { rows?: RegistryRow[] } | null)?.rows ?? [];

		const byCode = new Map<string, TransferDestination>();
		for (const { doc } of rows) {
			if (!doc || doc.type !== 'shelter' || typeof doc.code !== 'string' || !doc.code) continue;
			const key = doc.code.toUpperCase();
			if (key === own || byCode.has(key) || isShelterCancelled(doc)) continue;
			const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name : doc.code;
			byCode.set(key, { code: doc.code, name });
		}

		const destinations = [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'));
		return json(destinations, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Transfer destinations GET');
	}
};
