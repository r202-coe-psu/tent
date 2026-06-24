import { json } from '@sveltejs/kit';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';

export const GET = async ({ params }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		// Compute hash to look up in database (prevents IDOR)
		const tokenHash = await sha256Hex(tracking_token);

		// Find the donation across all shelter databases
		const resRegistry = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
		if (resRegistry.status >= 400) {
			throw new Error('Could not read registry');
		}
		const registryRows = (resRegistry.data as { rows?: { id: string; doc: any }[] })?.rows ?? [];
		const shelterCodes = registryRows
			.filter((r) => r.id.startsWith('shelter:') && r.doc)
			.map((r) => r.doc.code);

		let donation: any = null;
		for (const code of shelterCodes) {
			const dbName = `shelter_${code.toLowerCase()}`;
			const findRes = await adminRaw(`/${dbName}/_find`, 'POST', {
				selector: {
					type: 'donation',
					tracking_token_hash: tokenHash
				}
			});
			if (findRes.status === 200) {
				const docs = (findRes.data as { docs?: any[] })?.docs ?? [];
				if (docs.length > 0) {
					donation = docs[0];
					break;
				}
			}
		}

		if (!donation) {
			return json({ success: false, error: 'Donation record not found' }, { status: 404 });
		}

		// Return status and details WITHOUT PII (donor name, phone, email etc.)
		return json({
			success: true,
			donation: {
				status: donation.status,
				shelter_code: donation.shelter_code,
				items_declared: donation.items?.map((it: any) => ({
					item_name: it.free_text || it.item_id || 'ไม่ได้ระบุ',
					qty: it.qty,
					unit: it.unit
				})) ?? [],
				received_summary: donation.received_summary || null,
				created_at: donation.created_at,
				expires_at: donation.expires_at
			}
		});
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};

