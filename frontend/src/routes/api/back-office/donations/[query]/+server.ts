import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';

// Helper to find donation doc across all shelters by booking_ref or tracking_token_hash
async function findDonationByQuery(
	query: string
): Promise<{ donation: any; dbName: string } | null> {
	// 1. Get all shelter DBs from registry
	const resRegistry = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
	if (resRegistry.status >= 400) {
		throw new Error('Could not read registry');
	}
	const registryRows = (resRegistry.data as any)?.rows ?? [];
	const shelterCodes = registryRows
		.filter((r: any) => r.id.startsWith('shelter:') && r.doc?.code)
		.map((r: any) => r.doc.code as string);

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
			const docs = (findRes.data as any)?.docs ?? [];
			if (docs.length > 0) {
				return { donation: docs[0], dbName };
			}
		}
	}
	return null;
}

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		await requireAdmin(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
		}

		return json({
			success: true,
			donation: found.donation,
			dbName: found.dbName
		});
	} catch (e: any) {
		console.error(e);
		return json(
			{ success: false, error: e.message || 'Internal Server Error' },
			{ status: e.status || 500 }
		);
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		await requireAdmin(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
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
	} catch (e: any) {
		console.error(e);
		return json(
			{ success: false, error: e.message || 'Internal Server Error' },
			{ status: e.status || 500 }
		);
	}
};
