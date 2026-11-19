import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageStore } from '$lib/stores/language.svelte';
import { KioskRequestError } from './kiosk-check-in.api';
import { checkOutKioskMembers } from './kiosk-check-out.api';

const PRIMARY = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const MEMBER = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAW';

function stubFetch(status: number, payload: unknown) {
	const fetchMock = vi.fn<typeof fetch>(
		async () =>
			new Response(JSON.stringify(payload), {
				status,
				headers: { 'content-type': 'application/json' }
			})
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
	return JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
}

describe('checkOutKioskMembers', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		languageStore.setLanguage('th');
	});

	it('posts a smart-card check-out with the card citizen id and returns the members', async () => {
		const fetchMock = stubFetch(200, {
			shelter_code: 'SH001',
			members: [{ evacuee_id: PRIMARY, status: 'checked_out' }]
		});

		const result = await checkOutKioskMembers({
			primary_evacuee_id: PRIMARY,
			evacuee_ids: [PRIMARY, MEMBER],
			destination_type: 'returned_home',
			gate: { source: 'smart-card', citizen_id: '1234567890123' }
		});

		expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/kiosk/check-out');
		expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
		expect(sentBody(fetchMock)).toEqual({
			primary_evacuee_id: PRIMARY,
			evacuee_ids: [PRIMARY, MEMBER],
			source: 'smart-card',
			citizen_id: '1234567890123',
			destination_type: 'returned_home'
		});
		expect(result).toEqual({
			shelter_code: 'SH001',
			members: [{ evacuee_id: PRIMARY, status: 'checked_out' }]
		});
	});

	it('posts a ThaiD check-out with the session id and never a citizen id', async () => {
		const fetchMock = stubFetch(200, { shelter_code: 'SH001', members: [] });

		await checkOutKioskMembers({
			primary_evacuee_id: PRIMARY,
			evacuee_ids: [PRIMARY],
			destination_type: 'other',
			gate: { source: 'thaid', session_id: 'thaid-session-1' }
		});

		expect(sentBody(fetchMock)).toEqual({
			primary_evacuee_id: PRIMARY,
			evacuee_ids: [PRIMARY],
			source: 'thaid',
			thaid_session_id: 'thaid-session-1',
			destination_type: 'other'
		});
	});

	it('raises a KioskRequestError carrying the server code and Thai message', async () => {
		stubFetch(409, {
			error: { code: 'KIOSK_CHECK_OUT_IDENTITY_MISMATCH', message: 'บัตรนี้ไม่ตรง' }
		});

		await expect(
			checkOutKioskMembers({
				primary_evacuee_id: PRIMARY,
				evacuee_ids: [PRIMARY],
				destination_type: 'returned_home',
				gate: { source: 'smart-card', citizen_id: '1234567890123' }
			})
		).rejects.toMatchObject({ status: 409, code: 'KIOSK_CHECK_OUT_IDENTITY_MISMATCH' });
	});

	it.each([
		['INVALID_CHECK_OUT_INPUT', 'The list of people to check out is not valid.'],
		[
			'KIOSK_CHECK_OUT_IDENTITY_MISMATCH',
			'This card does not match the person checking out. Please contact staff.'
		],
		['KIOSK_CHECK_OUT_FAILED', 'Could not save the check-out. Please try again.']
	])('words %s in English from the code', async (code, expected) => {
		languageStore.setLanguage('en');
		stubFetch(400, { error: { code, message: 'ข้อความภาษาไทยจากเซิร์ฟเวอร์' } });

		const error = await checkOutKioskMembers({
			primary_evacuee_id: PRIMARY,
			evacuee_ids: [PRIMARY],
			destination_type: 'returned_home',
			gate: { source: 'smart-card', citizen_id: '1234567890123' }
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(KioskRequestError);
		expect((error as KioskRequestError).message).toBe(expected);
	});

	it('converts an aborted ten-second request into a retryable timeout error', async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_input: RequestInfo | URL, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () =>
							reject(new DOMException('aborted', 'AbortError'))
						);
					})
			)
		);

		const pending = checkOutKioskMembers({
			primary_evacuee_id: PRIMARY,
			evacuee_ids: [PRIMARY],
			destination_type: 'returned_home',
			gate: { source: 'smart-card', citizen_id: '1234567890123' }
		});
		const assertion = expect(pending).rejects.toMatchObject({ status: 0, code: 'TIMEOUT' });
		await vi.advanceTimersByTimeAsync(10_000);
		await assertion;
	});
});
