import { describe, expect, it, vi } from 'vitest';
import type { KioskFaceApi } from '../data/kiosk-face.api';
import {
	FACE_BURST_FRAMES,
	FACE_POSITION_TIMEOUT_MS,
	FACE_RETRY_MESSAGE_MS,
	faceHintMessage,
	faceRetryMessage,
	type FaceCheckOutcome,
	type FaceFrameReply,
	type FaceVerifyReply
} from '../domain/face-check';
import { FaceCheckSession, type FaceCamera } from './face-check-session.svelte';

const READY: FaceFrameReply = { face: true, hint: 'ok', ready: true };
const NOT_READY: FaceFrameReply = { face: true, hint: 'too_far', ready: false };

function setup(
	options: {
		frames?: FaceFrameReply[];
		verdicts?: FaceVerifyReply[];
		start?: Awaited<ReturnType<KioskFaceApi['start']>>;
		failStart?: boolean;
		failFrame?: boolean;
		failVerify?: boolean;
		failCamera?: boolean;
	} = {}
) {
	const frames = [...(options.frames ?? [READY, READY])];
	const verdicts = [...(options.verdicts ?? [{ result: 'match', attempt: 1 } as const])];
	const clock = { now: 1_000_000 };
	const camera: FaceCamera = {
		preview: vi.fn(async () => new Blob(['p'])),
		burst: vi.fn(async (count: number) => Array.from({ length: count }, () => new Blob(['b']))),
		stop: vi.fn()
	};
	const api: KioskFaceApi = {
		start: vi.fn(async () => {
			if (options.failStart) throw new Error('down');
			return options.start ?? { ok: true as const, reference: 'reading' as const };
		}),
		frame: vi.fn(async () => {
			if (options.failFrame) throw new Error('down');
			return frames.length > 1 ? frames.shift()! : frames[0];
		}),
		verify: vi.fn(async () => {
			if (options.failVerify) throw new Error('down');
			return verdicts.length > 1 ? verdicts.shift()! : verdicts[0];
		}),
		cancel: vi.fn(async () => {})
	};
	const finished: FaceCheckOutcome[] = [];
	const busy: boolean[] = [];
	const session = new FaceCheckSession({
		flow: 'walk_in',
		citizenId: '1234567890123',
		api,
		openCamera: async () => {
			if (options.failCamera) throw new Error('no camera');
			return camera;
		},
		onfinish: (outcome) => finished.push(outcome),
		onbusychange: (value) => busy.push(value),
		sleep: async (ms) => {
			clock.now += ms;
		},
		now: () => clock.now
	});
	return { session, api, camera, finished, busy, clock };
}

describe('FaceCheckSession', () => {
	it('waits for the person to agree before touching the camera or the scanner client', () => {
		const { session, api } = setup();

		expect(session.phase).toBe('consent');
		expect(api.start).not.toHaveBeenCalled();
	});

	it('declining records nothing and wipes what the scanner client may hold', () => {
		const { session, api, finished } = setup();

		session.decline();

		expect(finished).toEqual([{ kind: 'declined' }]);
		expect(session.phase).toBe('done');
		expect(api.cancel).toHaveBeenCalledOnce();
		expect(api.start).not.toHaveBeenCalled();
	});

	it('takes the burst once the person has been well framed twice in a row, then matches', async () => {
		const { session, api, camera, finished } = setup();

		await session.agree();

		expect(api.start).toHaveBeenCalledWith('1234567890123', 'walk_in');
		expect(camera.burst).toHaveBeenCalledWith(FACE_BURST_FRAMES, expect.any(Number));
		expect(api.verify).toHaveBeenCalledOnce();
		expect(finished).toEqual([{ kind: 'match' }]);
		expect(session.consentedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(camera.stop).toHaveBeenCalled();
	});

	it('keeps guiding with the hint until the person is framed', async () => {
		const { session, api, camera } = setup({ frames: [NOT_READY, READY, READY] });
		const shown: string[] = [];
		const frame = vi.mocked(api.frame);
		const replies = [NOT_READY, READY, READY];
		frame.mockImplementation(async () => {
			shown.push(session.message);
			return replies.shift() ?? READY;
		});

		await session.agree();

		// Each preview call sees what the previous reply put on screen.
		expect(shown[1]).toBe(faceHintMessage('too_far'));
		expect(shown[2]).toBe(faceHintMessage('ok'));
		expect(camera.burst).toHaveBeenCalledOnce();
	});

	it('a break in framing restarts the streak', async () => {
		const { session, api } = setup({ frames: [READY, NOT_READY, READY, READY] });

		await session.agree();

		expect(vi.mocked(api.frame).mock.calls.length).toBe(4);
		expect(api.verify).toHaveBeenCalledOnce();
	});

	it('asks to try again on a retry verdict, then finishes on the next one', async () => {
		const { session, api, finished } = setup({
			verdicts: [
				{ result: 'retry', hint: 'ok', attempt: 1 },
				{ result: 'match', attempt: 2 }
			]
		});

		await session.agree();

		expect(api.verify).toHaveBeenCalledTimes(2);
		expect(session.attempt).toBe(2);
		expect(finished).toEqual([{ kind: 'match' }]);
	});

	it('shows the retry advice for a moment between attempts', async () => {
		const { session, api, clock } = setup({
			verdicts: [
				{ result: 'retry', hint: 'ok', attempt: 1 },
				{ result: 'match', attempt: 2 }
			]
		});
		const adviceAt: number[] = [];
		const sleep = (session as unknown as { sleep: (ms: number) => Promise<void> }).sleep;
		(session as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async (ms) => {
			if (session.message === faceRetryMessage('ok')) adviceAt.push(ms);
			await sleep(ms);
		};

		await session.agree();

		expect(api.verify).toHaveBeenCalledTimes(2);
		expect(adviceAt).toContain(FACE_RETRY_MESSAGE_MS);
		expect(clock.now).toBeGreaterThan(1_000_000);
	});

	it.each([
		[{ result: 'not_confirmed', reason: 'retry_exhausted', attempt: 3 } as const, 'not_confirmed'],
		[{ result: 'skipped', reason: 'card_removed', attempt: 0 } as const, 'skipped']
	])('ends on the verdict %j without another attempt', async (verdict, kind) => {
		const { session, api, finished } = setup({ verdicts: [verdict] });

		await session.agree();

		expect(api.verify).toHaveBeenCalledOnce();
		expect(finished).toEqual([{ kind, reason: verdict.reason }]);
	});

	it('skips straight away when the card gave no photo', async () => {
		const { session, api, finished } = setup({ start: { ok: true, reference: 'unavailable' } });

		await session.agree();

		expect(finished).toEqual([{ kind: 'skipped', reason: 'no_chip_photo' }]);
		expect(api.frame).not.toHaveBeenCalled();
	});

	it('gives up positioning after the timeout without refusing anyone', async () => {
		const { session, finished, clock } = setup({ frames: [NOT_READY] });
		const stepper = vi.fn(async (ms: number) => {
			clock.now += ms + FACE_POSITION_TIMEOUT_MS / 3;
		});
		(session as unknown as { sleep: typeof stepper }).sleep = stepper;

		await session.agree();

		expect(finished).toEqual([{ kind: 'skipped', reason: 'timeout' }]);
	});

	it.each<[string, Parameters<typeof setup>[0]]>([
		['the scanner client will not start', { failStart: true }],
		['the camera cannot open', { failCamera: true }],
		['a preview call fails', { failFrame: true }],
		['the verdict call fails', { failVerify: true }]
	])('is unavailable, not stuck, when %s', async (_name, options) => {
		const { session, finished, camera } = setup(options);

		await session.agree();

		expect(finished).toEqual([{ kind: 'unavailable' }]);
		expect(session.phase).toBe('done');
		if (!options?.failStart && !options?.failCamera) expect(camera.stop).toHaveBeenCalled();
	});

	it('tells the page when to pause its idle timeout', async () => {
		const { session, busy } = setup();

		await session.agree();

		expect(busy).toEqual([true, false]);
	});

	it('wipes an unfinished check when the page goes away', async () => {
		const { session, api, camera } = setup({ frames: [NOT_READY] });
		const pending = session.agree();
		await Promise.resolve();

		session.destroy();
		await pending;

		expect(camera.stop).toHaveBeenCalled();
		expect(api.cancel).toHaveBeenCalled();
	});

	it('keeps a finished check for the server hand-off when the page goes away', async () => {
		const { session, api } = setup();
		await session.agree();

		session.destroy();

		expect(api.cancel).not.toHaveBeenCalled();
	});

	it('reports the end only once', async () => {
		const { session, finished } = setup();
		await session.agree();

		await session.agree();
		session.decline();

		expect(finished).toHaveLength(1);
	});
});
