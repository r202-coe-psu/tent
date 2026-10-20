import { afterEach, describe, expect, it, vi } from 'vitest';
import { preflightApplication } from './volunteer-api';

const input = {
	job_id: 'job:target',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	skills: [],
	shift_id: 'shift-morning',
	shift_date: '2026-09-20'
};

function respond(status: number, body: unknown) {
	const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('preflightApplication', () => {
	it('posts the input as is and returns the match', async () => {
		const fetchMock = respond(200, { success: true, match: 'no_match', message: 'ok' });

		await expect(preflightApplication(input)).resolves.toMatchObject({ match: 'no_match' });
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/public/v1/volunteer/apply/preflight',
			expect.objectContaining({ method: 'POST', body: JSON.stringify(input) })
		);
	});

	it.each([
		['JOB_NOT_OPEN', 409, 'งานอาสาสมัครนี้ปิดรับสมัครแล้ว'],
		[
			'WRITER_UNAVAILABLE',
			503,
			'ระบบรับสมัครขัดข้องชั่วคราว กรุณาลองใหม่ภายหลังหรือแจ้งเจ้าหน้าที่'
		],
		['PREFLIGHT_FAILED', 503, 'ตรวจสอบข้อมูลก่อนสมัครไม่สำเร็จ กรุณาลองใหม่อีกครั้ง']
	])('words %s with the same copy as the apply step', async (code, status, message) => {
		respond(status, { success: false, error: code });

		await expect(preflightApplication(input)).rejects.toThrow(message);
	});

	it("falls back to the server's message for a code it has no copy for", async () => {
		respond(400, { success: false, error: 'VALIDATION_ERROR', message: 'รูปแบบวันที่ไม่ถูกต้อง' });

		await expect(preflightApplication(input)).rejects.toThrow('รูปแบบวันที่ไม่ถูกต้อง');
	});

	it('does not treat a 200 without success as a result', async () => {
		respond(200, { success: false, error: 'JOB_NOT_FOUND' });

		await expect(preflightApplication(input)).rejects.toThrow(
			'ไม่พบงานอาสาสมัครนี้ อาจถูกปิดรับสมัครไปแล้ว'
		);
	});
});
