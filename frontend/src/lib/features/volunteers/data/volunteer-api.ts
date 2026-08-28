/**
 * Volunteer Access Portal data access.
 *
 * Browser → same-origin BFF `/api/public/v1/*` only. FastAPI `/public/v1/*` needs
 * EXTERNAL_API_SECRET, which the BFF injects; the SPA must never reach it directly
 * (CR-063).
 */
import type { ScheduleShift, TicketSummary, VolunteerTicket } from '../domain/volunteer';

const ERROR_COPY: Record<string, string> = {
	OFFER_NOT_FOUND: 'ไม่พบภารกิจนี้ หรือรหัสไม่ถูกต้อง กรุณาตรวจสอบกับเจ้าหน้าที่',
	OFFER_ALREADY_ANSWERED: 'ภารกิจนี้ถูกตอบไปแล้ว',
	TICKET_NOT_FOUND: 'ไม่พบตั๋วนี้ กรุณาตรวจสอบลิงก์อีกครั้ง',
	NOT_CANCELLABLE: 'ตั๋วนี้ยกเลิกไม่ได้แล้ว',
	RATE_LIMITED: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'
};

function apiError(body: unknown, status: number, fallback: string): Error {
	if (body && typeof body === 'object') {
		const code = (body as { error?: unknown }).error;
		if (typeof code === 'string') return new Error(ERROR_COPY[code] ?? code);
	}
	return new Error(fallback || `คำขอไม่สำเร็จ (${status})`);
}

async function readJson(response: Response): Promise<unknown> {
	return response.json().catch(() => null);
}

export async function getTicket(token: string): Promise<VolunteerTicket> {
	// Called as plain `fetch`, like every other call here. It used to take an injectable
	// `fetchFn` for a SvelteKit `load`, but this app has none (`ssr = false`, no server
	// load), and calling the global through that binding detached it from `window`.
	const response = await fetch(`/api/public/v1/volunteer/ticket/${encodeURIComponent(token)}`);
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ไม่สามารถเปิดตั๋วนี้ได้');
	}
	return (data as { ticket: VolunteerTicket }).ticket;
}

export async function findTickets(phone: string): Promise<TicketSummary[]> {
	const response = await fetch('/api/public/v1/volunteer/ticket/find', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ phone })
	});
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ค้นหาตั๋วไม่สำเร็จ');
	}
	return (data as { tickets?: TicketSummary[] }).tickets ?? [];
}

export async function cancelTicket(token: string): Promise<void> {
	const response = await fetch(
		`/api/public/v1/volunteer/ticket/${encodeURIComponent(token)}/cancel`,
		{ method: 'POST' }
	);
	if (!response.ok) {
		throw apiError(await readJson(response), response.status, 'ยกเลิกการสมัครไม่สำเร็จ');
	}
}

export async function fetchSchedule(phone: string): Promise<ScheduleShift[]> {
	const response = await fetch('/api/public/v1/volunteer/schedule', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ phone })
	});
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ไม่สามารถโหลดตารางงานได้');
	}
	return (data as { shifts?: ScheduleShift[] }).shifts ?? [];
}

export async function respondToDispatch(vars: {
	assignment_id: string;
	phone: string;
	code: string;
	action: 'accepted' | 'declined';
}): Promise<void> {
	const response = await fetch('/api/public/v1/volunteer/schedule/respond', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(vars)
	});
	if (!response.ok) {
		throw apiError(await readJson(response), response.status, 'ตอบรับภารกิจไม่สำเร็จ');
	}
}
