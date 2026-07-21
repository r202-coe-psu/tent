import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { donationIpLimiter } from '$lib/server/security/rate-limiter';
import { adminRaw } from '$lib/server/couch-admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { sha256Hex } from '$lib/db/hash';
import type { PublicDonationDoc } from '$lib/features/donations';

const FASTAPI_BASE = env.PUBLIC_FASTAPI_PROXY || 'http://localhost:9000';

function shelterDbFromToken(token: string): string | null {
	const match = token.match(/^TX-([A-Z0-9]+)-/);
	if (!match) return null;
	const code = match[1] === 'DON' ? 'SH001' : match[1];
	return `shelter_${code.toLowerCase()}`;
}

async function findByTokenHash(shelterDb: string, hash: string): Promise<PublicDonationDoc | null> {
	const res = await adminRaw(
		`/${shelterDb}/_all_docs?include_docs=true&startkey="donation:"&endkey="donation:\ufff0"`,
		'GET'
	);
	if (res.status >= 400) return null;
	const rows = (res.data as { rows?: { doc: PublicDonationDoc }[] })?.rows ?? [];
	for (const r of rows) {
		if (r.doc && r.doc.type === 'donation' && r.doc.tracking_token_hash === hash) return r.doc;
	}
	return null;
}

/** Pre-inbound: update courier tracking on the Mongo intake buffer via FastAPI. */
async function patchCourierViaFastApi(trackingToken: string, courierTrackingNo: string) {
	const res = await fetch(
		`${FASTAPI_BASE}/public/v1/donations/${encodeURIComponent(trackingToken)}`,
		{
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ courier_tracking_no: courierTrackingNo })
		}
	);
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

export const GET = async ({ params, getClientAddress }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const ip = getClientAddress();
		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		const res = await fetch(
			`${FASTAPI_BASE}/public/v1/donations/${encodeURIComponent(tracking_token)}`
		);
		const body = await res.json();
		if (!res.ok) {
			return json(body, { status: res.status });
		}

		const donation = body.donation as Record<string, unknown>;
		return json({
			success: true,
			donation: {
				status: donation.status,
				booking_ref: donation.booking_ref,
				shelter_code: donation.shelter_code,
				donor: donation.donor ?? {},
				items: donation.items ?? [],
				logistics: donation.logistics ?? null,
				received_summary: donation.received_summary ?? null,
				created_at: donation.updated_at,
				expires_at: donation.expires_at ?? null
			}
		});
	} catch {
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};

export const PATCH = async ({ params, request, getClientAddress }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const payload = await request.json();
		if (!payload.courier_tracking_no) {
			return json({ success: false, error: 'courier_tracking_no is required' }, { status: 400 });
		}

		const ip = getClientAddress();
		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		const shelterDb = shelterDbFromToken(tracking_token);
		if (!shelterDb) {
			return json({ success: false, error: 'Invalid tracking token format' }, { status: 400 });
		}
		const trackingTokenHash = await sha256Hex(tracking_token);

		const latestDoc = await findByTokenHash(shelterDb, trackingTokenHash);
		if (!latestDoc) {
			// Not in Couch yet (inbound poll lag) — update Mongo buffer so inbound persists it.
			const { status, body } = await patchCourierViaFastApi(
				tracking_token,
				payload.courier_tracking_no
			);
			if (status === 409) {
				return json(
					{
						success: false,
						error: 'Donation is syncing. Please refresh and try again in a moment.'
					},
					{ status: 409 }
				);
			}
			if (!status || status >= 400) {
				return json(
					typeof body === 'object' && body !== null
						? body
						: { success: false, error: 'Donation record not found' },
					{ status: status || 404 }
				);
			}
			return json({ success: true, message: 'Courier tracking number updated' });
		}

		if (!latestDoc.logistics || latestDoc.logistics.delivery_method !== 'parcel') {
			return json(
				{
					success: false,
					error: 'Courier tracking number can only be updated for parcel deliveries'
				},
				{ status: 400 }
			);
		}

		latestDoc.logistics.courier_tracking_no = payload.courier_tracking_no;
		latestDoc.updated_at = new Date().toISOString();

		let writeRes: { status: number; data: unknown };
		try {
			writeRes = await putAsPublicWriter(shelterDb, latestDoc._id, latestDoc);
		} catch {
			return json({ success: false, error: 'Server configuration error.' }, { status: 500 });
		}

		if (writeRes.status === 409) {
			return json(
				{
					success: false,
					error: 'Donation was updated elsewhere. Please refresh and try again.'
				},
				{ status: 409 }
			);
		}
		if (writeRes.status !== 201 && writeRes.status !== 200) {
			return json({ success: false, error: 'Database update failed' }, { status: 500 });
		}

		return json({ success: true, message: 'Courier tracking number updated' });
	} catch {
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
