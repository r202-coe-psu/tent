import { json } from '@sveltejs/kit';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { sha256Hex } from '$lib/db/hash';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import {
	isDonorEditable,
	toTrackingLogistics,
	type PublicDonationDoc
} from '$lib/features/donations/server';
import {
	CouchReadError,
	findByTokenHash,
	GOODS_IN_STOCK_ERROR,
	hasKeyedDonationStock
} from '$lib/server/donation-docs';

function shelterDbFromToken(token: string): string | null {
	const match = token.match(/^TX-([A-Z0-9]+)-/);
	if (!match) return null;
	const code = match[1] === 'DON' ? 'SH001' : match[1];
	return `shelter_${code.toLowerCase()}`;
}

/** CouchDB could not be read, so nothing was changed anywhere — the donor may retry. */
function donationUnavailable(e: CouchReadError) {
	console.error(e);
	return json({ success: false, error: 'DONATION_UNAVAILABLE' }, { status: 503 });
}

/** Pre-inbound: update courier tracking on the Mongo intake buffer via FastAPI. */
async function patchCourierViaFastApi(trackingToken: string, courierTrackingNo: string) {
	const res = await fetch(
		`${fastapiBaseUrl()}/public/v1/donations/${encodeURIComponent(trackingToken)}`,
		{
			method: 'PATCH',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ courier_tracking_no: courierTrackingNo })
		}
	);
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

/** Pre-inbound: cancel on the Mongo intake buffer via FastAPI. */
async function cancelViaFastApi(trackingToken: string) {
	const res = await fetch(
		`${fastapiBaseUrl()}/public/v1/donations/${encodeURIComponent(trackingToken)}`,
		{ method: 'DELETE', headers: fastapiServiceHeaders() }
	);
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

export const GET = async ({ params }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		let donation: Record<string, unknown> = {};
		let fastapiErrorStatus = 0;
		let fastapiErrorBody: unknown = null;

		try {
			const res = await fetch(
				`${fastapiBaseUrl()}/public/v1/donations/${encodeURIComponent(tracking_token)}`,
				{ headers: fastapiServiceHeaders() }
			);
			const body = await res.json().catch(() => ({}));
			if (res.ok) {
				donation = (body.donation as Record<string, unknown>) ?? {};
			} else {
				fastapiErrorStatus = res.status;
				fastapiErrorBody = body;
			}
		} catch {
			fastapiErrorStatus = 503;
			fastapiErrorBody = { success: false, error: 'FastAPI unavailable' };
		}

		const shelterDb = shelterDbFromToken(tracking_token);
		let latestDoc: PublicDonationDoc | null = null;
		if (shelterDb) {
			try {
				const trackingTokenHash = await sha256Hex(tracking_token);
				latestDoc = await findByTokenHash(shelterDb, trackingTokenHash);
			} catch {
				// CouchDB lookup is optional overlay
			}
		}

		if (!latestDoc && fastapiErrorStatus > 0) {
			return json(
				fastapiErrorBody && typeof fastapiErrorBody === 'object'
					? fastapiErrorBody
					: { success: false, error: 'Donation not found' },
				{ status: fastapiErrorStatus }
			);
		}

		return json({
			success: true,
			donation: {
				status: latestDoc?.status ?? donation.status,
				booking_ref: latestDoc?.booking_ref ?? donation.booking_ref,
				shelter_code: latestDoc?.shelter_code ?? donation.shelter_code,
				donor: latestDoc?.donor ?? donation.donor ?? {},
				items: latestDoc?.items ?? donation.items ?? [],
				// CR-209 FR-4 — allowlisted, so `vehicle_plate` never leaves through tracking.
				logistics: toTrackingLogistics(latestDoc?.logistics ?? donation.logistics),
				received_summary: latestDoc?.received_summary ?? donation.received_summary ?? null,
				// CR-172 FR-14 — staff wrote it for the donor; the doc wins over the projection lag.
				reject_reason: latestDoc?.reject_reason ?? donation.reject_reason ?? null,
				reject_reason_code: latestDoc?.reject_reason_code ?? donation.reject_reason_code ?? null,
				updated_at: latestDoc?.updated_at ?? donation.updated_at ?? null,
				expires_at: latestDoc?.expires_at ?? donation.expires_at ?? null,
				revisions: latestDoc?.revisions ?? donation.revisions ?? []
			}
		});
	} catch {
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};

export const PATCH = async ({ params, request }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const payload = await request.json();
		if (!payload.courier_tracking_no) {
			return json({ success: false, error: 'courier_tracking_no is required' }, { status: 400 });
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

		if (!isDonorEditable(latestDoc.status)) {
			return json(
				{
					success: false,
					error: `Cannot update a donation in status "${latestDoc.status}"`
				},
				{ status: 400 }
			);
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
	} catch (e) {
		if (e instanceof CouchReadError) return donationUnavailable(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};

export const DELETE = async ({ params }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const shelterDb = shelterDbFromToken(tracking_token);
		if (!shelterDb) {
			return json({ success: false, error: 'Invalid tracking token format' }, { status: 400 });
		}
		const trackingTokenHash = await sha256Hex(tracking_token);

		const latestDoc = await findByTokenHash(shelterDb, trackingTokenHash);
		if (!latestDoc) {
			// Not in Couch yet (inbound poll lag) — cancel the Mongo buffer directly.
			const { status, body } = await cancelViaFastApi(tracking_token);
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
			return json({ success: true, message: 'Donation cancelled successfully' });
		}

		if (!isDonorEditable(latestDoc.status)) {
			return json(
				{
					success: false,
					error: `Cannot cancel donation in status "${latestDoc.status}"`
				},
				{ status: 400 }
			);
		}
		// Goods already keyed: cancelling would hand the quota back with the goods on the shelf.
		if (await hasKeyedDonationStock(shelterDb, latestDoc._id)) {
			return json(GOODS_IN_STOCK_ERROR, { status: 409 });
		}

		latestDoc.status = 'cancelled';
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

		return json({ success: true, message: 'Donation cancelled successfully' });
	} catch (e) {
		if (e instanceof CouchReadError) return donationUnavailable(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
