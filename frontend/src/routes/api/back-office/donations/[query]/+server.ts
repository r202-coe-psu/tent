import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { hasStaffCapability, isShelterManager } from '$lib/auth/roles';
import {
	type PublicDonationDoc,
	type ScanDonationView,
	receiveDonationInputSchema
} from '$lib/features/donations';
import { fetchDocs } from '$lib/server/donation-docs';
import { sha256Hex } from '$lib/db/hash';

type RegistryRow = { id: string; doc?: { code?: string } };
type RegistryAllDocs = { rows?: RegistryRow[] };

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

// Find donation doc across all shelters by booking_ref or tracking_token_hash.
// Uses _all_docs scan (no Mango index required — same pattern as public tracking lookup).
async function findDonationByQuery(
	query: string
): Promise<{ donation: PublicDonationDoc; dbName: string } | null> {
	const resRegistry = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
	if (resRegistry.status >= 400) {
		throw new Error('Could not read registry');
	}
	const registryRows = (resRegistry.data as RegistryAllDocs)?.rows ?? [];
	const shelterCodes = registryRows
		.filter((r) => r.id.startsWith('shelter:') && r.doc?.code)
		.map((r) => r.doc!.code as string);

	const tokenHash = await sha256Hex(query);

	for (const code of shelterCodes) {
		const dbName = `shelter_${code.toLowerCase()}`;
		const donations = await fetchDocs<PublicDonationDoc>(dbName, 'donation:');
		const match = donations.find(
			(d) =>
				d?.type === 'donation' && (d.booking_ref === query || d.tracking_token_hash === tokenHash)
		);
		if (match) return { donation: match, dbName };
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

		return json({
			success: true,
			donation: toScanView(found.donation)
		});
	} catch (e) {
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
		const parsed = receiveDonationInputSchema.safeParse(body);
		if (!parsed.success) {
			return json(
				{ success: false, error: 'Invalid input', details: parsed.error.flatten() },
				{ status: 422 }
			);
		}

		const { donation, dbName } = found;

		if (donation.status === 'received') {
			return json(
				{ success: false, error: 'Donation is already received (LOCKED)' },
				{ status: 400 }
			);
		}

		const nowStr = new Date().toISOString();
		const updated: PublicDonationDoc = {
			...donation,
			status: 'received',
			received_at: nowStr,
			updated_at: nowStr,
			items: parsed.data.items ?? donation.items
		};

		const saveRes = await adminRaw(`/${dbName}/${donation._id}`, 'PUT', updated);
		if (saveRes.status === 409) {
			return json(
				{
					success: false,
					error: 'Donation was updated by another process. Please search again and retry.'
				},
				{ status: 409 }
			);
		}
		if (saveRes.status >= 400) {
			throw new Error(`Failed to update donation to CouchDB: ${JSON.stringify(saveRes.data)}`);
		}

		return json({
			success: true,
			donation: toScanView(updated)
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};
