import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	blobToBase64,
	cancelKioskFaceCheck,
	createKioskFaceApi,
	KioskFaceError,
	KIOSK_FACE_PATH
} from './kiosk-face.api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const jpeg = (text: string) => new Blob([text], { type: 'image/jpeg' });

function lastCall(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>) {
	const [url, init] = fetchFn.mock.calls.at(-1)!;
	return { url: String(url), init: init as RequestInit };
}

describe('createKioskFaceApi', () => {
	it('starts a check with the card number and the flow', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ ok: true, reference: 'reading' }));

		await expect(createKioskFaceApi(fetchFn).start('1234567890123', 'check_in')).resolves.toEqual({
			ok: true,
			reference: 'reading'
		});

		const { url, init } = lastCall(fetchFn);
		expect(url).toBe(`${KIOSK_FACE_PATH}/start`);
		expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
		expect(JSON.parse(init.body as string)).toEqual({
			citizen_id: '1234567890123',
			flow: 'check_in'
		});
	});

	it('sends a preview frame as raw JPEG and returns the hint', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ face: true, hint: 'too_far', ready: false }));
		const frame = jpeg('frame');

		await expect(createKioskFaceApi(fetchFn).frame(frame)).resolves.toEqual({
			face: true,
			hint: 'too_far',
			ready: false
		});

		const { url, init } = lastCall(fetchFn);
		expect(url).toBe(`${KIOSK_FACE_PATH}/frame`);
		expect(init.body).toBe(frame);
		expect(init.headers).toMatchObject({ 'content-type': 'image/jpeg' });
	});

	it('sends the burst as base64 JPEGs and returns the verdict', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ result: 'match', attempt: 1 }));

		await expect(createKioskFaceApi(fetchFn).verify([jpeg('one'), jpeg('two')])).resolves.toEqual({
			result: 'match',
			attempt: 1
		});

		const body = JSON.parse(lastCall(fetchFn).init.body as string) as { frames: string[] };
		expect(body.frames.map((frame) => atob(frame))).toEqual(['one', 'two']);
	});

	it('turns an error response into KioskFaceError with the scanner client code', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ error: { code: 'FACE_CHECK_NOT_STARTED' } }, 409));

		await expect(createKioskFaceApi(fetchFn).frame(jpeg('x'))).rejects.toMatchObject({
			name: 'KioskFaceError',
			status: 409,
			code: 'FACE_CHECK_NOT_STARTED'
		});
	});

	it('rejects a reply that is not the documented shape', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ result: 'maybe' }));

		const error = await createKioskFaceApi(fetchFn)
			.verify([jpeg('x')])
			.catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(KioskFaceError);
		expect((error as KioskFaceError).code).toBe('INVALID_FACE_REPLY');
	});

	it('cancels without ever throwing', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));

		await expect(createKioskFaceApi(fetchFn).cancel()).resolves.toBeUndefined();
		await expect(createKioskFaceApi(fetchFn).cancel('camera_denied')).resolves.toBeUndefined();
		expect(lastCall(fetchFn).url).toBe(`${KIOSK_FACE_PATH}/cancel`);
	});

	it('cancels with an empty body when there is no reason', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));

		await createKioskFaceApi(fetchFn).cancel();

		const { url, init } = lastCall(fetchFn);
		expect(url).toBe(`${KIOSK_FACE_PATH}/cancel`);
		expect(init.method).toBe('POST');
		expect(init.body).toBe('{}');
		expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
	});

	it('tells the scanner client why when it cancels', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));

		await createKioskFaceApi(fetchFn).cancel('user_skipped');

		expect(JSON.parse(lastCall(fetchFn).init.body as string)).toEqual({ reason: 'user_skipped' });
	});

	it('passes the attempt limit and the chip-photo state through when the scanner client sends them', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ ok: true, reference: 'ready', max_attempts: 4 }));

		await expect(createKioskFaceApi(fetchFn).start('1234567890123', 'check_in')).resolves.toEqual({
			ok: true,
			reference: 'ready',
			max_attempts: 4
		});
	});

	it('encodes large blobs without overflowing the call stack', async () => {
		const big = new Blob([new Uint8Array(300_000).fill(65)]);

		const encoded = await blobToBase64(big);

		expect(atob(encoded)).toHaveLength(300_000);
	});
});

describe('cancelKioskFaceCheck', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('posts a cancel to the scanner client', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));
		vi.stubGlobal('fetch', fetchFn);

		await cancelKioskFaceCheck();

		expect(String(fetchFn.mock.calls[0][0])).toBe(`${KIOSK_FACE_PATH}/cancel`);
		expect((fetchFn.mock.calls[0][1] as RequestInit).body).toBe('{}');
	});

	it('forwards the reason', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));
		vi.stubGlobal('fetch', fetchFn);

		await cancelKioskFaceCheck('scanner_unreachable');

		expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({
			reason: 'scanner_unreachable'
		});
	});

	it('never throws, so a page can call it on its way out', async () => {
		vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')));

		await expect(cancelKioskFaceCheck()).resolves.toBeUndefined();
	});
});
