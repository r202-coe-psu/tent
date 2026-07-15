import { json } from '@sveltejs/kit';
import { listShelterMasters } from '$lib/server/shelters.admin';
import { adminRaw } from '$lib/server/couch-admin';
import { expireDonation } from '$lib/features/donations';
import type { Donation } from '$lib/features/operations';

async function handleExpireReservations() {
	try {
		const activeMasters = await listShelterMasters();
		const shelterCodes = activeMasters.map((m) => m.code);
		const summary: Record<string, { scanned: number; expired: number }> = {};
		const now = new Date();

		for (const code of shelterCodes) {
			const dbName = `shelter_${code.toLowerCase()}`;

			// Fetch all docs to filter donations
			const res = await adminRaw(`/${dbName}/_all_docs?include_docs=true`, 'GET');
			if (res.status !== 200) {
				console.error(`Failed to fetch documents for shelter ${code}:`, res.data);
				continue;
			}

			const rows = (res.data as { rows?: { doc?: unknown }[] })?.rows ?? [];
			const docs = rows.map((r) => r.doc).filter(Boolean);
			const donations = docs.filter(
				(d): d is Donation => !!d && (d as { type?: unknown }).type === 'donation'
			);

			const expiredDocs: Donation[] = [];

			for (const donation of donations) {
				if (donation.status === 'declared') {
					const expiryTime = new Date(donation.expires_at);
					if (expiryTime < now) {
						try {
							const expired = expireDonation(donation);
							expiredDocs.push(expired);
						} catch (e) {
							console.error(`Failed to expire donation ${donation._id}:`, e);
						}
					}
				}
			}

			if (expiredDocs.length > 0) {
				// Save expired donations back to CouchDB in bulk
				const bulkRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', { docs: expiredDocs });
				if (bulkRes.status !== 201 && bulkRes.status !== 200) {
					console.error(
						`Failed to save expired donations in bulk for shelter ${code}:`,
						bulkRes.data
					);
				}
			}

			summary[code] = {
				scanned: donations.length,
				expired: expiredDocs.length
			};
		}

		return {
			success: true,
			as_of: now.toISOString(),
			summary
		};
	} catch (e) {
		console.error('Error during expire-reservations job:', e);
		throw e;
	}
}

export const GET = async () => {
	try {
		const result = await handleExpireReservations();
		return json(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Internal Server Error';
		return json({ success: false, error: message }, { status: 500 });
	}
};

export const POST = async () => {
	try {
		const result = await handleExpireReservations();
		return json(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Internal Server Error';
		return json({ success: false, error: message }, { status: 500 });
	}
};
