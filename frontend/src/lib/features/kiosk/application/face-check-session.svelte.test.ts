import { describe, expect, it, vi } from 'vitest';
import { KioskFaceError, type KioskFaceApi } from '../data/kiosk-face.api';
import {
	FACE_BURST_FRAMES,
	FACE_BYPASSED_BY_STAFF,
	FACE_DEFAULT_MAX_ATTEMPTS,
	FACE_POSITION_TIMEOUT_MS,
	FACE_PREVIEW_INTERVAL_MS,
	FACE_RETRY_MESSAGE_MS,
	FACE_SKIPPED_BY_PERSON,
	FACE_SLOW_NOTICE_MS,
	faceHintMessage,
	faceRetryMessage,
	type FaceCheckFlow,
	type FaceCheckOutcome,
	type FaceFrameReply,
	type FaceVerifyReply
} from '../domain/face-check';
import { FaceCheckSession, type FaceCamera } from './face-check-session.svelte';

const READY: FaceFrameReply = { face: true, hint: 'ok', ready: true };
const NOT_READY: FaceFrameReply = { face: true, hint: 'too_far', ready: false };
const framing = (hint: FaceFrameReply['hint']): FaceFrameReply => ({
	face: true,
	hint,
	ready: false
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

function setup(
	options: {
		frames?: FaceFrameReply[];
		verdicts?: FaceVerifyReply[];
		start?: Awaited<ReturnType<KioskFaceApi['start']>>;
		failStart?: boolean;
		failFrame?: boolean;
		failVerify?: boolean;
		flow?: FaceCheckFlow;
		failCamera?: boolean | unknown;
		failPreview?: unknown;
		/** Calls the test resolves later, to act while the session is waiting on them. */
		holdStart?: ReturnType<typeof deferred<void>>;
		holdOpen?: ReturnType<typeof deferred<void>>;
		holdBurst?: ReturnType<typeof deferred<void>>;
		/** Runs on every sleep, after the clock moved. */
		onSleep?: (ms: number) => void;
	} = {}
) {
	const frames = [...(options.frames ?? [READY, READY])];
	const verdicts = [...(options.verdicts ?? [{ result: 'match', attempt: 1 } as const])];
	const clock = { now: 1_000_000 };
	const camera: FaceCamera = {
		preview: vi.fn(async () => {
			if (options.failPreview) throw options.failPreview;
			return new Blob(['p']);
		}),
		burst: vi.fn(async (count: number) => {
			await options.holdBurst?.promise;
			return Array.from({ length: count }, () => new Blob(['b']));
		}),
		stop: vi.fn()
	};
	const api: KioskFaceApi = {
		start: vi.fn(async () => {
			await options.holdStart?.promise;
			if (options.failStart) throw new KioskFaceError(503, null);
			return options.start ?? { ok: true as const, reference: 'reading' as const };
		}),
		frame: vi.fn(async () => {
			if (options.failFrame) throw new KioskFaceError(503, null);
			return frames.length > 1 ? frames.shift()! : frames[0];
		}),
		verify: vi.fn(async () => {
			if (options.failVerify) throw new TypeError('Failed to fetch');
			return verdicts.length > 1 ? verdicts.shift()! : verdicts[0];
		}),
		cancel: vi.fn(async () => {})
	};
	const finished: FaceCheckOutcome[] = [];
	const busy: boolean[] = [];
	const session = new FaceCheckSession({
		flow: options.flow ?? 'walk_in',
		citizenId: '1234567890123',
		api,
		openCamera: async () => {
			await options.holdOpen?.promise;
			if (options.failCamera) {
				throw options.failCamera === true
					? new DOMException('no camera', 'NotFoundError')
					: options.failCamera;
			}
			return camera;
		},
		onfinish: (outcome) => finished.push(outcome),
		onbusychange: (value) => busy.push(value),
		sleep: async (ms) => {
			clock.now += ms;
			options.onSleep?.(ms);
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

	it('shows the framing instruction once it repeats, and "hold still" at once when framed', async () => {
		const { session, api } = setup();
		const shown: string[] = [];
		const replies = [framing('too_far'), framing('too_far'), READY, READY];
		vi.mocked(api.frame).mockImplementation(async () => {
			shown.push(session.message);
			return replies.shift() ?? READY;
		});

		await session.agree();

		// Each preview call sees what the previous replies put on screen.
		expect(shown[1]).toBe(faceHintMessage('ok')); // one too_far is not enough yet
		expect(shown[2]).toBe(faceHintMessage('too_far')); // repeated: now shown
		expect(shown[3]).toBe(faceHintMessage('ok')); // ready: shown immediately
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

	it.each<[string, Parameters<typeof setup>[0], FaceCheckOutcome]>([
		[
			'the scanner client will not start',
			{ failStart: true },
			{ kind: 'unavailable', reason: 'scanner_unreachable' }
		],
		[
			'the camera cannot be found',
			{ failCamera: true },
			{ kind: 'unavailable', reason: 'camera_not_found' }
		],
		[
			'the camera permission is refused',
			{ failCamera: new DOMException('no', 'NotAllowedError') },
			{ kind: 'unavailable', reason: 'camera_denied' }
		],
		[
			'the camera fails some other way',
			{ failCamera: new DOMException('busy', 'NotReadableError') },
			{ kind: 'unavailable', reason: 'camera_failed' }
		],
		[
			'a preview frame cannot be taken',
			{ failPreview: new Error('camera has no picture yet') },
			{ kind: 'unavailable', reason: 'camera_failed' }
		],
		[
			'a preview call fails',
			{ failFrame: true },
			{ kind: 'unavailable', reason: 'scanner_unreachable' }
		],
		[
			'the verdict call fails',
			{ failVerify: true },
			{ kind: 'unavailable', reason: 'scanner_unreachable' }
		]
	])('is unavailable, not stuck, when %s', async (_name, options, expected) => {
		const { session, finished, camera, api } = setup(options);

		await session.agree();

		expect(finished).toEqual([expected]);
		expect(session.phase).toBe('done');
		expect(api.cancel).toHaveBeenCalledExactlyOnceWith((expected as { reason: string }).reason);
		if (!options?.failStart && !options?.failCamera) expect(camera.stop).toHaveBeenCalled();
	});

	it('does not leave a camera running that opened after the scanner client failed', async () => {
		const holdOpen = deferred<void>();
		const { session, camera, finished } = setup({ failStart: true, holdOpen });
		const pending = session.agree();
		await Promise.resolve();

		holdOpen.resolve();
		await pending;

		expect(camera.stop).toHaveBeenCalledOnce();
		expect(finished).toEqual([{ kind: 'unavailable', reason: 'scanner_unreachable' }]);
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

/** Feeds the session these preview replies, noting what it showed before each, then has the person skip. */
async function watchFrames(replies: FaceFrameReply[], options: Parameters<typeof setup>[0] = {}) {
	const ctx = setup(options);
	const seen: { message: string; framingProblem: boolean; frameReady: boolean }[] = [];
	const queue = [...replies];
	vi.mocked(ctx.api.frame).mockImplementation(async () => {
		seen.push({
			message: ctx.session.message,
			framingProblem: ctx.session.framingProblem,
			frameReady: ctx.session.frameReady
		});
		const reply = queue.shift()!;
		if (queue.length === 0) ctx.session.skip();
		return reply;
	});
	await ctx.session.agree();
	return { ...ctx, seen };
}

describe('FaceCheckSession hint hysteresis', () => {
	const ok = faceHintMessage('ok');
	const tooFar = faceHintMessage('too_far');

	it('does not flicker while the hint flips every frame', async () => {
		const { seen } = await watchFrames([
			framing('too_far'),
			framing('ok'),
			framing('too_far'),
			framing('ok'),
			framing('too_far'),
			framing('ok')
		]);

		expect(seen.map((frame) => frame.message)).toEqual(Array(6).fill(ok));
	});

	it('shows a problem hint only once it has repeated, and keeps it through one stray frame', async () => {
		const { seen } = await watchFrames([
			framing('too_far'),
			framing('too_far'),
			framing('ok'),
			framing('too_far'),
			framing('ok'),
			framing('ok')
		]);

		expect(seen.map((frame) => frame.message)).toEqual([ok, ok, tooFar, tooFar, tooFar, tooFar]);
	});

	it('needs the repeats to be of the same hint, not any problem', async () => {
		const { seen } = await watchFrames([
			framing('too_far'),
			framing('too_close'),
			framing('too_far'),
			framing('too_far')
		]);

		expect(seen.map((frame) => frame.message)).toEqual([ok, ok, ok, ok]);
	});

	it('shows the framed state at once, even right after a problem was shown', async () => {
		const { seen } = await watchFrames([
			framing('too_far'),
			framing('too_far'),
			READY,
			framing('too_far')
		]);

		expect(seen.map((frame) => frame.message)).toEqual([ok, ok, tooFar, ok]);
	});

	it('flags a framing problem only for the instruction on screen, not a pending photo read', async () => {
		const { seen } = await watchFrames([
			framing('too_far'),
			framing('too_far'),
			framing('reference_pending'),
			framing('reference_pending'),
			framing('ok')
		]);

		expect(seen.map((frame) => frame.framingProblem)).toEqual([false, false, true, true, false]);
	});

	it('tracks whether the last preview frame was framed, and clears it between attempts', async () => {
		const { seen, session } = await watchFrames([framing('too_far'), READY, framing('ok')]);

		expect(seen.map((frame) => frame.frameReady)).toEqual([false, false, true]);
		expect(session.frameReady).toBe(false); // the check is over
	});

	it('clears frameReady when a retry verdict sends the person back to positioning', async () => {
		const { session, api } = setup({
			verdicts: [
				{ result: 'retry', hint: 'too_dark', attempt: 1 },
				{ result: 'match', attempt: 2 }
			]
		});
		const atPreview: boolean[] = [];
		vi.mocked(api.frame).mockImplementation(async () => {
			atPreview.push(session.frameReady);
			return READY;
		});

		await session.agree();

		// Call 1 and 2 start the first burst; the two after the retry start from "not framed".
		expect(atPreview).toEqual([false, true, false, true]);
	});

	it('keeps the retry advice, and its framing flag, until a different hint repeats', async () => {
		const { session, api } = setup({
			verdicts: [{ result: 'retry', hint: 'too_dark', attempt: 1 }]
		});
		const seen: { message: string; problem: boolean }[] = [];
		let calls = 0;
		vi.mocked(api.frame).mockImplementation(async () => {
			calls += 1;
			seen.push({ message: session.message, problem: session.framingProblem });
			if (calls > 3) session.skip();
			return calls <= 2 ? READY : framing('too_dark');
		});

		await session.agree();

		// calls 1-2 take the burst; calls 3-4 are the first previews after "too dark" advice.
		expect(seen[2]).toEqual({ message: faceHintMessage('too_dark'), problem: true });
		expect(seen[3]).toEqual({ message: faceHintMessage('too_dark'), problem: true });
	});
});

describe('FaceCheckSession.cardRemovable (check-in)', () => {
	it('stays false until the scanner client reports the chip photo as read', async () => {
		const { session, api } = setup({ flow: 'check_in' });
		const seen: boolean[] = [];
		const replies: FaceFrameReply[] = [
			{ ...framing('reference_pending'), reference: 'reading' },
			{ ...framing('reference_pending'), reference: 'reading' },
			{ ...READY, reference: 'ready' },
			{ ...READY, reference: 'ready' }
		];
		vi.mocked(api.frame).mockImplementation(async () => {
			seen.push(session.cardRemovable);
			return replies.shift() ?? READY;
		});

		expect(session.cardRemovable).toBe(false); // consent
		await session.agree();

		expect(seen).toEqual([false, false, false, true]);
	});

	it('is true from the start when the start reply says the photo is already read', async () => {
		const { session, api } = setup({
			flow: 'check_in',
			start: { ok: true, reference: 'ready' }
		});
		let atFirstFrame: boolean | null = null;
		vi.mocked(api.frame).mockImplementation(async () => {
			atFirstFrame ??= session.cardRemovable;
			return READY;
		});

		await session.agree();

		expect(atFirstFrame).toBe(true);
	});

	it('stays true once the photo was read, even if a later frame says nothing', async () => {
		const { session, api } = setup({ flow: 'check_in' });
		const seen: boolean[] = [];
		const replies: FaceFrameReply[] = [{ ...framing('too_far'), reference: 'ready' }, NOT_READY];
		vi.mocked(api.frame).mockImplementation(async () => {
			seen.push(session.cardRemovable);
			if (replies.length === 0) session.skip();
			return replies.shift() ?? NOT_READY;
		});

		await session.agree();

		expect(seen.slice(1)).toEqual([true, true]);
	});

	it.each([
		['the check ends in a match', {}],
		['the card gave no photo', { start: { ok: true, reference: 'unavailable' } as const }],
		['the camera fails', { failCamera: true }]
	] as const)('is true once the check is over: %s', async (_name, options) => {
		const { session } = setup({ flow: 'check_in', ...options });

		await session.agree();

		expect(session.phase).toBe('done');
		expect(session.cardRemovable).toBe(true);
	});

	it('is true after the person skips the camera', async () => {
		const { session } = await watchFrames([NOT_READY, NOT_READY], { flow: 'check_in' });

		expect(session.cardRemovable).toBe(true);
	});

	it('is false for the walk-in flow throughout', async () => {
		const { session, api } = setup({ flow: 'walk_in', start: { ok: true, reference: 'ready' } });
		const seen: boolean[] = [];
		vi.mocked(api.frame).mockImplementation(async () => {
			seen.push(session.cardRemovable);
			return { ...READY, reference: 'ready' };
		});

		await session.agree();

		expect(seen.length).toBeGreaterThan(0);
		expect(seen.every((value) => value === false)).toBe(true);
		expect(session.cardRemovable).toBe(false);
	});
});

describe('FaceCheckSession.skip', () => {
	it('stops the camera, wipes the check and ends on a skip the person chose', async () => {
		const { session, api, camera, finished } = await watchFrames([NOT_READY, NOT_READY]);

		expect(finished).toEqual([{ kind: 'skipped', reason: FACE_SKIPPED_BY_PERSON }]);
		expect(session.outcome).toEqual({ kind: 'skipped', reason: 'user_skipped' });
		expect(session.phase).toBe('done');
		expect(camera.stop).toHaveBeenCalled();
		expect(api.cancel).toHaveBeenCalledExactlyOnceWith('user_skipped');
		expect(api.verify).not.toHaveBeenCalled();
	});

	it('works while the camera is still opening, and does not leave it running', async () => {
		const holdOpen = deferred<void>();
		const { session, api, camera, finished, busy } = setup({ holdOpen });
		const pending = session.agree();
		expect(session.phase).toBe('starting');

		session.skip();
		holdOpen.resolve();
		await pending;

		expect(finished).toEqual([{ kind: 'skipped', reason: 'user_skipped' }]);
		expect(session.phase).toBe('done');
		expect(camera.stop).toHaveBeenCalledOnce();
		expect(api.frame).not.toHaveBeenCalled();
		expect(busy).toEqual([true, false]);
		// Once for the skip, once more for a photo read that may have landed after it.
		expect(vi.mocked(api.cancel).mock.calls).toEqual([['user_skipped'], []]);
	});

	it('works while the scanner client is still starting', async () => {
		const holdStart = deferred<void>();
		const { session, camera, finished, api } = setup({ holdStart });
		const pending = session.agree();

		session.skip();
		holdStart.resolve();
		await pending;

		expect(finished).toEqual([{ kind: 'skipped', reason: 'user_skipped' }]);
		expect(camera.stop).toHaveBeenCalledOnce();
		expect(api.frame).not.toHaveBeenCalled();
	});

	it('works while the verdict is being read: the camera stops and the late verdict is ignored', async () => {
		const holdBurst = deferred<void>();
		const { session, camera, finished, api } = setup({
			holdBurst,
			verdicts: [{ result: 'match', attempt: 1 }]
		});
		const pending = session.agree();
		await vi.waitFor(() => expect(session.phase).toBe('verifying'));

		session.skip();
		holdBurst.resolve();
		await pending;

		expect(finished).toEqual([{ kind: 'skipped', reason: 'user_skipped' }]);
		expect(session.phase).toBe('done');
		expect(session.outcome).toEqual({ kind: 'skipped', reason: 'user_skipped' });
		expect(camera.stop).toHaveBeenCalled();
		expect(api.cancel).toHaveBeenCalledExactlyOnceWith('user_skipped');
	});

	it('does not go back to positioning when a retry verdict arrives after the skip', async () => {
		const holdBurst = deferred<void>();
		const { session, camera, finished, api, busy } = setup({
			holdBurst,
			verdicts: [{ result: 'retry', hint: 'too_far', attempt: 1 }]
		});
		const pending = session.agree();
		await vi.waitFor(() => expect(session.phase).toBe('verifying'));

		session.skip();
		holdBurst.resolve();
		await pending;

		expect(session.phase).toBe('done');
		expect(finished).toEqual([{ kind: 'skipped', reason: 'user_skipped' }]);
		expect(busy).toEqual([true, false]);
		expect(api.frame).toHaveBeenCalledTimes(2); // the preview never resumed
		expect(camera.stop).toHaveBeenCalled();
	});

	it('works during the pause that shows retry advice, and the preview does not resume', async () => {
		let ref: FaceCheckSession | null = null;
		const ctx = setup({
			verdicts: [{ result: 'retry', hint: 'ok', attempt: 1 }],
			onSleep: (ms) => {
				if (ms === FACE_RETRY_MESSAGE_MS) ref?.skip();
			}
		});
		ref = ctx.session;

		await ctx.session.agree();

		expect(ctx.finished).toEqual([{ kind: 'skipped', reason: 'user_skipped' }]);
		expect(ctx.api.frame).toHaveBeenCalledTimes(2); // only the two before the burst
		expect(ctx.api.verify).toHaveBeenCalledOnce();
	});

	it('is a no-op before the person agreed and after the check ended', async () => {
		const first = setup();
		first.session.skip();
		expect(first.session.phase).toBe('consent');
		expect(first.finished).toEqual([]);
		expect(first.api.cancel).not.toHaveBeenCalled();

		const second = setup();
		await second.session.agree();
		second.session.skip();
		expect(second.finished).toEqual([{ kind: 'match' }]);
		expect(second.session.outcome).toEqual({ kind: 'match' });
		expect(second.api.cancel).not.toHaveBeenCalled();
	});

	it('reports the end only once when skipped twice', async () => {
		const { session, finished } = await watchFrames([NOT_READY, NOT_READY]);

		session.skip();

		expect(finished).toHaveLength(1);
	});
});

type Sleeper = { sleep: (ms: number) => Promise<void> };

describe('FaceCheckSession slow notice', () => {
	it('turns on once positioning has lasted the notice time, and not before', async () => {
		const { session, api, clock, finished } = setup({ frames: [NOT_READY] });
		(session as unknown as Sleeper).sleep = async () => {
			clock.now += 10_000;
		};
		const seen: boolean[] = [];
		vi.mocked(api.frame).mockImplementation(async () => {
			seen.push(session.slow);
			return NOT_READY;
		});

		await session.agree();

		expect(FACE_SLOW_NOTICE_MS).toBe(30_000);
		// The preview is polled at 0, 10, 20 and 30 s ... until the 45 s timeout.
		expect(seen).toEqual([false, false, false, true, true]);
		expect(finished).toEqual([{ kind: 'skipped', reason: 'timeout' }]);
	});

	it('is off again after a retry restarts positioning', async () => {
		const { session, api, clock } = setup({
			verdicts: [
				{ result: 'retry', hint: 'ok', attempt: 1 },
				{ result: 'match', attempt: 2 }
			]
		});
		let sleeps = 0;
		(session as unknown as Sleeper).sleep = async (ms) => {
			sleeps += 1;
			clock.now += sleeps <= 2 ? 16_000 : ms; // two slow polls, then the real pace
		};
		const seen: boolean[] = [];
		const replies = [NOT_READY, NOT_READY, READY, READY, READY, READY];
		vi.mocked(api.frame).mockImplementation(async () => {
			seen.push(session.slow);
			return replies.shift() ?? READY;
		});

		await session.agree();

		// 0 s, 16 s, 32 s (slow), then framed -> burst -> retry -> slow cleared for the next attempt.
		expect(seen.slice(0, 4)).toEqual([false, false, true, true]);
		expect(seen.at(-1)).toBe(false);
		expect(session.slow).toBe(false);
	});

	it('still times out when no burst counts as an attempt', async () => {
		// Every burst is unusable (movement, flicker): the scanner client keeps answering attempt 0.
		const { session, api, finished } = setup({
			frames: [READY],
			verdicts: [{ result: 'retry', hint: 'ok', attempt: 0 }]
		});

		await session.agree();

		expect(finished).toEqual([{ kind: 'skipped', reason: 'timeout' }]);
		expect(session.attempt).toBe(0);
		expect(vi.mocked(api.verify).mock.calls.length).toBeGreaterThan(1);
	});

	it('stays off for a quick check', async () => {
		const { session } = setup();

		await session.agree();

		expect(session.slow).toBe(false);
	});
});

describe('FaceCheckSession.maxAttempts', () => {
	it('is the default of 3 until the scanner client says otherwise', async () => {
		const { session } = setup();

		expect(session.maxAttempts).toBe(FACE_DEFAULT_MAX_ATTEMPTS);
		expect(FACE_DEFAULT_MAX_ATTEMPTS).toBe(3);
		await session.agree();
		expect(session.maxAttempts).toBe(3);
	});

	it('takes the limit from the start reply', async () => {
		const { session, api } = setup({ start: { ok: true, reference: 'reading', max_attempts: 5 } });
		let atFirstFrame = 0;
		vi.mocked(api.frame).mockImplementation(async () => {
			atFirstFrame ||= session.maxAttempts;
			return READY;
		});

		await session.agree();

		expect(atFirstFrame).toBe(5);
	});
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Holds the session for staff at its `holdAt`-th preview pause (the loop then waits on resume). */
function setupHeld(holdAt: number, options: Parameters<typeof setup>[0] = {}) {
	let ref: FaceCheckSession | null = null;
	let pauses = 0;
	const ctx = setup({
		frames: [NOT_READY],
		...options,
		onSleep: (ms) => {
			if (ms === FACE_PREVIEW_INTERVAL_MS && ++pauses === holdAt) ref?.hold();
		}
	});
	ref = ctx.session;
	return ctx;
}

describe('FaceCheckSession.hold (staff PIN)', () => {
	it('stops sending frames while held, stays busy, and carries on after resume', async () => {
		const { session, api, finished } = setupHeld(2);
		const pending = session.agree();
		await flush();

		expect(session.held).toBe(true);
		expect(session.phase).toBe('positioning');
		expect(session.busy).toBe(true);
		const framesWhileHeld = vi.mocked(api.frame).mock.calls.length;
		await flush();
		expect(api.frame).toHaveBeenCalledTimes(framesWhileHeld);
		expect(finished).toEqual([]);

		session.resume();
		await pending;

		expect(session.held).toBe(false);
		expect(vi.mocked(api.frame).mock.calls.length).toBeGreaterThan(framesWhileHeld);
		expect(finished).toEqual([{ kind: 'skipped', reason: 'timeout' }]);
	});

	it('does not count the time held towards the positioning timeout', async () => {
		const { session, api, clock } = setupHeld(2);
		const pending = session.agree();
		await flush();
		const framesWhileHeld = vi.mocked(api.frame).mock.calls.length;

		clock.now += FACE_POSITION_TIMEOUT_MS * 2;
		session.resume();
		await pending;

		// Without the pause being discounted it would time out before another frame.
		expect(vi.mocked(api.frame).mock.calls.length).toBeGreaterThan(framesWhileHeld + 10);
	});

	it('ends as a staff bypass when staff enter the PIN, and tells the scanner client why', async () => {
		const { session, api, camera, finished } = setupHeld(2);
		const pending = session.agree();
		await flush();

		session.skip(FACE_BYPASSED_BY_STAFF);
		await pending;

		expect(finished).toEqual([{ kind: 'skipped', reason: FACE_BYPASSED_BY_STAFF }]);
		expect(session.held).toBe(false);
		expect(camera.stop).toHaveBeenCalled();
		expect(api.cancel).toHaveBeenCalledExactlyOnceWith('staff_bypass');
	});

	it('keeps a verdict that arrives while held until resume', async () => {
		const holdBurst = deferred<void>();
		const { session, finished } = setup({ holdBurst });
		const pending = session.agree();
		await vi.waitFor(() => expect(session.phase).toBe('verifying'));

		session.hold();
		holdBurst.resolve();
		await flush();
		expect(finished).toEqual([]);

		session.resume();
		await pending;
		expect(finished).toEqual([{ kind: 'match' }]);
	});

	it('drops a verdict that arrives while held when staff bypass the check', async () => {
		const holdBurst = deferred<void>();
		const { session, finished } = setup({ holdBurst });
		const pending = session.agree();
		await vi.waitFor(() => expect(session.phase).toBe('verifying'));

		session.hold();
		holdBurst.resolve();
		await flush();
		session.skip(FACE_BYPASSED_BY_STAFF);
		await pending;

		expect(finished).toEqual([{ kind: 'skipped', reason: 'staff_bypass' }]);
	});

	it('does not hold before the person agreed or after the end', async () => {
		const first = setup();
		first.session.hold();
		expect(first.session.held).toBe(false);

		const second = setup();
		await second.session.agree();
		second.session.hold();
		expect(second.session.held).toBe(false);
	});

	it('lets the page go while held', async () => {
		const { session, finished } = setupHeld(2);
		const pending = session.agree();
		await flush();

		session.destroy();
		await pending;

		expect(finished).toEqual([]);
	});
});

describe('FaceCheckSession.cardRemoved (check-in)', () => {
	it('ends as card_removed while the chip photo is still needed', async () => {
		const { session, api, finished } = setupHeld(2, { flow: 'check_in' });
		const pending = session.agree();
		await flush();

		session.cardRemoved();
		await pending;

		expect(finished).toEqual([{ kind: 'skipped', reason: 'card_removed' }]);
		expect(api.cancel).toHaveBeenCalledOnce();
	});

	it('asks the scanner client first while held, and carries on if the photo was read meanwhile', async () => {
		const { session, api, finished } = setupHeld(2, { flow: 'check_in' });
		const pending = session.agree();
		await flush();
		expect(session.cardRemovable).toBe(false);
		vi.mocked(api.frame).mockResolvedValueOnce({ ...NOT_READY, reference: 'ready' });

		await session.cardRemoved();

		expect(finished).toEqual([]);
		expect(session.cardRemovable).toBe(true);
		expect(api.cancel).not.toHaveBeenCalled();
		session.destroy();
		await pending;
	});

	it('changes nothing once the chip photo was read, or on walk-in', async () => {
		const read = setupHeld(2, {
			flow: 'check_in',
			start: { ok: true, reference: 'ready' }
		});
		const readPending = read.session.agree();
		await flush();
		read.session.cardRemoved();
		expect(read.finished).toEqual([]);
		read.session.destroy();
		await readPending;

		const walkIn = setupHeld(2);
		const walkInPending = walkIn.session.agree();
		await flush();
		walkIn.session.cardRemoved();
		expect(walkIn.finished).toEqual([]);
		walkIn.session.destroy();
		await walkInPending;
	});
});

describe('FaceCheckSession match with the chip photo', () => {
	it('passes the chip photo on with the match', async () => {
		const { session, finished } = setup({
			flow: 'check_in',
			verdicts: [{ result: 'match', attempt: 1, chip_photo: 'AAAA' }]
		});

		await session.agree();

		expect(finished).toEqual([{ kind: 'match', chipPhoto: 'AAAA' }]);
	});
});
