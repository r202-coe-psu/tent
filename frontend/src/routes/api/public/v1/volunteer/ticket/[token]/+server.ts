import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import { isTicketCancellable, resolveTicket } from '$lib/features/volunteers/server/public-ticket';

function maskPhone(phone: string | null | undefined): string {
	if (!phone) return 'xxx-xxx-xxxx';
	const digits = phone.replace(/\D/g, '');
	if (digits.length < 4) return 'xxx-xxx-xxxx';
	return `xxx-xxx-${digits.slice(-4)}`;
}

/** Digital Pass (CR-092 screen 2). The token is the only credential. */
export const GET: RequestHandler = async ({ params, fetch }) => {
	const token = params.token?.trim();
	if (!token) {
		return json({ success: false, error: 'TICKET_NOT_FOUND' }, { status: 404 });
	}

	// 1. CouchDB is the system of record; cancel resolves the ticket through the same call.
	try {
		const resolved = await resolveTicket(token);
		if (resolved) {
			const { dbName, shelter, app, volunteer } = resolved;
			let jobTitle = 'งานจิตอาสาประจำศูนย์พักพิง';
			if (app?.job_id) {
				try {
					const jobRes = await adminRaw(`/${dbName}/${encodeURIComponent(app.job_id)}`, 'GET');
					const title = (jobRes.data as { title?: string } | undefined)?.title;
					if (jobRes.status === 200 && title) jobTitle = title;
				} catch {
					// Ignore
				}
			}

			const applicantName = app?.applicant?.first_name
				? `${app.applicant.first_name} ${app.applicant.last_name || ''}`.trim()
				: volunteer
					? `${volunteer.first_name} ${volunteer.last_name || ''}`.trim()
					: 'จิตอาสาผู้สมัคร';
			const tokenOut = app?.tracking_token || volunteer?.tracking_token || token;

			return json(
				{
					success: true,
					ticket: {
						token: tokenOut,
						can_cancel: isTicketCancellable(app),
						application_id: app?._id,
						status:
							app?.status || (volunteer?.status === 'active' ? 'confirmed' : 'pending_review'),
						job_id: app?.job_id || '',
						job_title: jobTitle,
						shelter_name: shelter.name,
						shelter_code: shelter.code,
						applicant_name: applicantName,
						phone_masked: maskPhone(app?.applicant?.phone || volunteer?.phone || ''),
						skills: app?.applicant?.skills || [],
						selected_shift: {
							date: app?.selected_shift?.date || '',
							start_time: app?.selected_shift?.start_time || '',
							end_time: app?.selected_shift?.end_time || '',
							station: null
						},
						applied_at: app?.created_at || volunteer?.created_at || new Date().toISOString(),
						qr_payload: `/volunteer/ticket/${tokenOut}`
					}
				},
				{ headers: { 'Cache-Control': 'no-store' } }
			);
		}
	} catch {
		// Fall through to FastAPI
	}

	// 2. Legacy fallback: an application that exists only in the FastAPI buffer/projection.
	// Cancel writes CouchDB only, so such a pass cannot be cancelled from here.
	try {
		const res = await fetch(
			`${fastapiBaseUrl()}/public/v1/volunteer/ticket/${encodeURIComponent(token)}`,
			{ headers: fastapiServiceHeaders() }
		);
		if (res.ok) {
			const body = (await res.json()) as { ticket?: Record<string, unknown> };
			if (body.ticket) body.ticket.can_cancel = false;
			return json(body, { headers: { 'Cache-Control': 'no-store' } });
		}
	} catch {
		// FastAPI offline
	}

	return json({ success: false, error: 'TICKET_NOT_FOUND' }, { status: 404 });
};
