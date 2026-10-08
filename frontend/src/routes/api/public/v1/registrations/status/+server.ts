import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';

import { evacueeIdFromBookingCode } from '$lib/features/public-register/server';
import { listShelterMasters } from '$lib/server/shelters.admin';
import { adminRaw } from '$lib/server/couch-admin';
import { registerLookupIpLimiter } from '$lib/server/security/rate-limiter';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };

const statusRequestSchema = z.object({
	code: z.string().trim().min(1, 'Booking code required')
});

interface EvacueeDoc {
	type?: string;
	current_stay?: { status?: string };
}

function statusUnavailable() {
	return json(
		{ success: false, verified: false, error: 'STATUS_UNAVAILABLE' },
		{ status: 502, headers: noStore }
	);
}

async function handleStatusCheck(code: string, clientIp: string, fetchFn: typeof globalThis.fetch) {
	const parsed = statusRequestSchema.safeParse({ code });
	if (!parsed.success) {
		return json(
			{ success: false, verified: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}

	if (!registerLookupIpLimiter.check(clientIp)) {
		return json(
			{ success: false, verified: false, error: 'RATE_LIMITED' },
			{ status: 429, headers: noStore }
		);
	}

	const docId = evacueeIdFromBookingCode(parsed.data.code);

	// 1. Search CouchDB shelter databases
	try {
		const masters = await listShelterMasters();
		for (const master of masters) {
			const res = await adminRaw(
				`/${shelterDbName(master.code)}/${encodeURIComponent(docId)}`,
				'GET'
			);
			if (res.status !== 200) continue;

			const doc = res.data as EvacueeDoc | null;
			if (!doc || doc.type !== 'evacuee') continue;

			const stayStatus = doc.current_stay?.status;
			// Verified = stay is no longer 'pre_registered' (arriving, active, room_confirmed, etc.)
			const verified = Boolean(stayStatus && stayStatus !== 'pre_registered');

			return json(
				{
					success: true,
					verified,
					status: stayStatus ?? 'unknown'
				},
				{ status: 200, headers: noStore }
			);
		}
	} catch {
		// Couch search fallback
	}

	// 2. Central-queue ticket via FastAPI (service Bearer, status-only, no PII).
	// Only a real 404 means "deleted" (→ notFound below). Any other failure is an upstream
	// problem and MUST NOT be reported as notFound — the client would drop the user's QR.
	try {
		const upstream = `${fastapiBaseUrl()}/public/v1/unassigned-registrations/${encodeURIComponent(parsed.data.code)}/status`;
		const res = await fetchFn(upstream, {
			headers: fastapiServiceHeaders({ Accept: 'application/json' })
		});
		if (res.ok) {
			const body = (await res.json()) as { status?: string; claimed?: boolean };
			return json(
				{
					success: true,
					verified: body.claimed === true,
					status: body.status ?? 'open'
				},
				{ status: 200, headers: noStore }
			);
		}
		if (res.status !== 404) {
			return statusUnavailable();
		}
	} catch {
		return statusUnavailable();
	}

	return json(
		{ success: true, verified: false, notFound: true, error: 'BOOKING_NOT_FOUND' },
		{ status: 200, headers: noStore }
	);
}

export const POST: RequestHandler = async ({ request, getClientAddress, fetch }) => {
	const payload = await request.json().catch(() => null);
	const code = (
		payload && typeof payload === 'object' && 'code' in payload ? payload.code : ''
	) as string;
	return handleStatusCheck(code, getClientAddress(), fetch);
};

export const GET: RequestHandler = async ({ url, getClientAddress, fetch }) => {
	const code = url.searchParams.get('code') ?? '';
	return handleStatusCheck(code, getClientAddress(), fetch);
};
