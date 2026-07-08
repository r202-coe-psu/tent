import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { hasStaffCapability, isShelterManager } from '$lib/auth/roles';
import type { PublicDonationDoc, ScanDonationView } from '$lib/features/donations';
import { sha256Hex } from '$lib/db/hash';

type RegistryRow = { id: string; doc?: { code?: string } };
type RegistryAllDocs = { rows?: RegistryRow[] };
type FindResult = { docs?: PublicDonationDoc[] };

function routeErrorResponse(e: unknown) {
	const message = e instanceof Error ? e.message : 'Internal Server Error';
	const status =
		typeof e === 'object' &&
		e !== null &&
		'status' in e &&
		typeof (e as { status: unknown }).status === 'number'
			? (e as { status: number }).status
			: 500;
	return json({ success: false, error: message || 'Internal Server Error' }, { status });
}

// Project a raw donation doc to the redacted view the scan UI needs (no _rev,
// tracking_token_hash, phone_hash, timestamps). Full phone kept for warehouse staff.
function toScanView(d: PublicDonationDoc): ScanDonationView {
	return {
		booking_ref: d.booking_ref,
		shelter_code: d.shelter_code,
		status: d.status,
		donor: { name: d.donor?.name ?? '', phone: d.donor?.phone ?? null },
		items: (d.items ?? []).map((it) => ({
			item_id: it.item_id,
			free_text: it.free_text,
			qty: it.qty,
			unit: it.unit
		})),
		logistics: d.logistics
	};
}

// Warehouse scan-station is for warehouse_staff (+ shelter_manager / SA), NOT CouchDB _admin.
// Mirrors the CR-024 capability pattern (requireKitchen) — see $lib/guards/auth.ts.
async function authorizeWarehouse(cookie: string | null): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie); // authenticated; resolves roles/scope
	const allowed =
		caller.isSA ||
		isShelterManager(caller.roles) ||
		hasStaffCapability(caller.roles, 'warehouse_staff');
	if (!allowed) throw error(403, 'Requires warehouse_staff, shelter_manager, or system_admin');
	return caller;
}

// Helper to find donation doc across all shelters by booking_ref or tracking_token_hash
async function findDonationByQuery(
	query: string
): Promise<{ donation: PublicDonationDoc; dbName: string } | null> {
	// 1. Get all shelter DBs from registry
	const resRegistry = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
	if (resRegistry.status >= 400) {
		throw new Error('Could not read registry');
	}
	const registryRows = (resRegistry.data as RegistryAllDocs)?.rows ?? [];
	const shelterCodes = registryRows
		.filter((r) => r.id.startsWith('shelter:') && r.doc?.code)
		.map((r) => r.doc!.code as string);

	const tokenHash = await sha256Hex(query);

	// 2. Search in each shelter database
	for (const code of shelterCodes) {
		const dbName = `shelter_${code.toLowerCase()}`;
		const findRes = await adminRaw(`/${dbName}/_find`, 'POST', {
			selector: {
				type: 'donation',
				$or: [{ booking_ref: query }, { tracking_token_hash: tokenHash }]
			}
		});
		if (findRes.status === 200) {
			const docs = (findRes.data as FindResult)?.docs ?? [];
			if (docs.length > 0) {
				return { donation: docs[0], dbName };
			}
		}
	}
	return null;
}

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
		}

		// Shelter-scope isolation: non-SA callers may only see donations of their own shelter.
		if (!caller.isSA && caller.shelterCode !== found.donation.shelter_code) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		// Redact — return only what the scan UI needs, not the raw CouchDB doc
		return json({
			success: true,
			donation: toScanView(found.donation)
		});
	} catch (e) {
		console.error(e);
		return routeErrorResponse(e);
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
		}

		// Shelter-scope isolation: non-SA callers may only receive donations of their own shelter.
		if (!caller.isSA && caller.shelterCode !== found.donation.shelter_code) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		const body = await request.json();
		const { items, status } = body;

		const { donation, dbName } = found;

		if (donation.status === 'received') {
			return json(
				{ success: false, error: 'Donation is already received (LOCKED)' },
				{ status: 400 }
			);
		}

		const nowStr = new Date().toISOString();
		const updated = {
			...donation,
			status: status || 'received',
			received_at: nowStr,
			updated_at: nowStr,
			items: items || donation.items
		};

		const saveRes = await adminRaw(`/${dbName}/${donation._id}`, 'PUT', updated);
		if (saveRes.status >= 400) {
			throw new Error(`Failed to update donation to CouchDB: ${JSON.stringify(saveRes.data)}`);
		}

		return json({
			success: true,
			donation: updated
		});
	} catch (e) {
		console.error(e);
		return routeErrorResponse(e);
	}
};
