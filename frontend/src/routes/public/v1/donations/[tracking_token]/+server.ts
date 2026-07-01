import { json } from '@sveltejs/kit';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';

interface DonationDoc {
	_id: string;
	_rev?: string;
	type: string;
	status?: string;
	shelter_code?: string;
	booking_ref?: string | null;
	items?: { item_id?: string; free_text?: string; qty?: number; unit?: string }[];
	logistics?: {
		delivery_method?: string;
		vehicle?: string | null;
		slot?: unknown;
		courier_tracking_no?: string | null;
	} | null;
	received_summary?: unknown;
	created_at?: string;
	expires_at?: string;
	updated_at?: string;
	[key: string]: unknown;
}

// หา donation ข้ามทุก shelter db ด้วย hash ของ tracking_token (กัน IDOR — ไม่เก็บ token ตรง)
async function findDonationByTokenHash(
	tokenHash: string
): Promise<{ donation: DonationDoc; dbName: string } | null> {
	const resRegistry = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
	if (resRegistry.status >= 400) {
		throw new Error('Could not read registry');
	}
	const registryRows =
		(resRegistry.data as { rows?: { id: string; doc?: { code?: string } }[] })?.rows ?? [];
	const shelterCodes = registryRows
		.filter((r) => r.id.startsWith('shelter:') && r.doc?.code)
		.map((r) => r.doc!.code as string);

	for (const code of shelterCodes) {
		const dbName = `shelter_${code.toLowerCase()}`;
		const findRes = await adminRaw(`/${dbName}/_find`, 'POST', {
			selector: {
				type: 'donation',
				tracking_token_hash: tokenHash
			}
		});
		if (findRes.status === 200) {
			const docs = (findRes.data as { docs?: DonationDoc[] })?.docs ?? [];
			if (docs.length > 0) {
				return { donation: docs[0], dbName };
			}
		}
	}
	return null;
}

export const GET = async ({ params }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const tokenHash = await sha256Hex(tracking_token);
		const found = await findDonationByTokenHash(tokenHash);
		if (!found) {
			return json({ success: false, error: 'Donation record not found' }, { status: 404 });
		}
		const { donation } = found;

		// Return status and details WITHOUT PII (donor name, phone, email etc.)
		return json({
			success: true,
			donation: {
				status: donation.status,
				shelter_code: donation.shelter_code,
				booking_ref: donation.booking_ref ?? null,
				items_declared:
					donation.items?.map((it) => ({
						item_name: it.free_text || it.item_id || 'ไม่ได้ระบุ',
						qty: it.qty,
						unit: it.unit
					})) ?? [],
				logistics: donation.logistics
					? {
							delivery_method: donation.logistics.delivery_method ?? null,
							vehicle: donation.logistics.vehicle ?? null,
							slot: donation.logistics.slot ?? null,
							courier_tracking_no: donation.logistics.courier_tracking_no ?? null,
							pickup_address: (donation.logistics as any).pickup_address ?? null
						}
					: null,
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

// DN-6: donor แก้เลข courier tracking ของตัวเองภายหลังผ่าน ticket (auth = token hash)
export const PATCH = async ({ params, request }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const body = (await request.json().catch(() => ({}))) as { courier_tracking_no?: unknown };
		const courier = body?.courier_tracking_no;
		if (courier !== null && courier !== undefined && typeof courier !== 'string') {
			return json(
				{ success: false, error: 'courier_tracking_no must be a string or null' },
				{ status: 400 }
			);
		}

		const tokenHash = await sha256Hex(tracking_token);
		const found = await findDonationByTokenHash(tokenHash);
		if (!found) {
			return json({ success: false, error: 'Donation record not found' }, { status: 404 });
		}
		const { donation, dbName } = found;

		// อัปเดตเฉพาะ courier_tracking_no ใน logistics — ไม่แตะ field อื่น
		const updated: DonationDoc = {
			...donation,
			logistics: {
				...(donation.logistics ?? { delivery_method: 'self_dropoff' }),
				courier_tracking_no: (courier as string | null) ?? null
			},
			updated_at: new Date().toISOString()
		};

		const saveRes = await adminRaw(`/${dbName}/${donation._id}`, 'PUT', updated);
		if (saveRes.status >= 400) {
			throw new Error(`Failed to update donation: ${JSON.stringify(saveRes.data)}`);
		}

		return json({ success: true, courier_tracking_no: updated.logistics?.courier_tracking_no });
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
