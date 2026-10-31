import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplyFailedError, apiErrorCopy, applyToJob, preflightApplication } from './volunteer-api';

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

describe('applyToJob', () => {
	const application = {
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		phone: '0812345678',
		skills: [],
		shifts: [{ shift_id: 'am' }, { shift_id: 'pm' }]
	};

	it('returns the per-shift results of a partly saved request', async () => {
		const results = [
			{ ok: true, shift_id: 'am', status: 'confirmed', tracking_token: 'TKT-AM' },
			{ ok: false, shift_id: 'pm', error: 'SHIFT_FULL' }
		];
		respond(201, { success: true, tracking_token: 'TKT-AM', status: 'confirmed', results });

		await expect(applyToJob('job:target', application)).resolves.toMatchObject({ results });
	});

	it('throws ApplyFailedError carrying every shift reason when nothing was saved', async () => {
		const results = [
			{ ok: false, shift_id: 'am', error: 'TIME_CONFLICT' },
			{ ok: false, shift_id: 'pm', error: 'SHIFT_FULL' }
		];
		respond(409, { success: false, error: 'TIME_CONFLICT', results });

		const error = await applyToJob('job:target', application).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ApplyFailedError);
		expect((error as ApplyFailedError).message).toBe('คุณมีกะงานอื่นที่เวลาทับซ้อนกัน');
		expect((error as ApplyFailedError).results).toEqual(results);
	});

	it('throws a plain error for a refusal that is not about shifts', async () => {
		respond(429, { success: false, error: 'RATE_LIMITED' });

		const error = await applyToJob('job:target', application).catch((e: unknown) => e);

		expect(error).not.toBeInstanceOf(ApplyFailedError);
		expect((error as Error).message).toBe('ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
	});
});

describe('cancel error copy', () => {
	it.each(['CANCEL_FAILED', 'NOT_CANCELLABLE', 'SHIFT_STARTED'])('has Thai copy for %s', (code) => {
		expect(apiErrorCopy(code)).toMatch(/[ก-๙]/);
	});
});
