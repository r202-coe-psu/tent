import { SvelteDate } from 'svelte/reactivity';
import type { KioskFaceApi } from '../data/kiosk-face.api';
import {
	FACE_BURST_FRAMES,
	FACE_DEFAULT_MAX_ATTEMPTS,
	FACE_BURST_INTERVAL_MS,
	FACE_POSITION_TIMEOUT_MS,
	FACE_PREVIEW_INTERVAL_MS,
	FACE_READY_STREAK,
	FACE_RETRY_MESSAGE_MS,
	FACE_SKIPPED_BY_PERSON,
	FACE_HINT_CONFIRM_FRAMES,
	FACE_SLOW_NOTICE_MS,
	classifyFaceFailure,
	faceHintMessage,
	faceRetryMessage,
	type FaceCheckFlow,
	type FaceCheckOutcome,
	type FaceHint,
	type FaceVerifyReply
} from '../domain/face-check';

/** What the session needs from the camera; the browser implementation is in face-camera.ts. */
export type FaceCamera = {
	/** One small JPEG for the live preview check. */
	preview(): Promise<Blob>;
	/** `count` JPEGs `intervalMs` apart, for the verdict. */
	burst(count: number, intervalMs: number): Promise<Blob[]>;
	stop(): void;
};

export type FaceCheckPhase = 'consent' | 'starting' | 'positioning' | 'verifying' | 'done';

export type FaceCheckSessionDeps = {
	flow: FaceCheckFlow;
	citizenId: string;
	api: KioskFaceApi;
	openCamera: () => Promise<FaceCamera>;
	/** Called once, when the check ends in any way. */
	onfinish: (outcome: FaceCheckOutcome) => void;
	/** True while the person must be left alone (camera running); the idle timeout should pause. */
	onbusychange?: (busy: boolean) => void;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
};

const BUSY_PHASES: readonly FaceCheckPhase[] = ['starting', 'positioning', 'verifying'];

/**
 * One person's face check, driven from the kiosk page: consent → open the camera → watch the
 * preview until the person is well framed → take a burst → read the verdict (try again if told to)
 * → done. It never refuses anyone: every ending is an outcome the caller turns into "continue".
 */
export class FaceCheckSession {
	phase = $state<FaceCheckPhase>('consent');
	/** The instruction on screen while positioning; a short sentence for the person. */
	message = $state(faceHintMessage('ok'));
	attempt = $state(0);
	outcome = $state<FaceCheckOutcome | null>(null);
	/** ISO time the person agreed to the check; the consent record for what is stored later. */
	consentedAt = $state<string | null>(null);
	/** Attempts the scanner client allows, for "attempt 2 of N". */
	maxAttempts = $state(FACE_DEFAULT_MAX_ATTEMPTS);
	/** Whether the latest preview frame showed a well-framed face (for the guide outline). */
	frameReady = $state(false);
	/** Positioning has gone on long enough to tell the person staff will help if it does not work. */
	slow = $state(false);

	private camera: FaceCamera | null = null;
	private stopped = false;
	private referenceReady = $state(false);
	/** The hint behind `message`, and a different one seen on the last few frames in a row. */
	private shownHint = $state<FaceHint>('ok');
	private candidateHint: FaceHint | null = null;
	private candidateFrames = 0;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly now: () => number;

	constructor(private readonly deps: FaceCheckSessionDeps) {
		this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.now = deps.now ?? Date.now;
	}

	get busy(): boolean {
		return BUSY_PHASES.includes(this.phase);
	}

	/** The page left or the check already finished (e.g. the person skipped) while a call was out. */
	private get ended(): boolean {
		return this.stopped || this.phase === 'done';
	}

	/**
	 * Check-in only: the chip photo has been read (or the check is over), so the card may come out.
	 * Until then the person is asked to leave it in.
	 */
	get cardRemovable(): boolean {
		return this.deps.flow === 'check_in' && (this.referenceReady || this.phase === 'done');
	}

	/** The instruction on screen asks the person to change something (not "ok", not waiting on the card). */
	get framingProblem(): boolean {
		return this.shownHint !== 'ok' && this.shownHint !== 'reference_pending';
	}

	/** The person agreed: start the check on the scanner client and open the camera. */
	async agree(): Promise<void> {
		if (this.phase !== 'consent') return;
		this.consentedAt = new SvelteDate(this.now()).toISOString();
		this.setPhase('starting');
		// Wait for both even when one fails, so a camera that opens late is never left running.
		const [started, opened] = await Promise.allSettled([
			this.deps.api.start(this.deps.citizenId, this.deps.flow),
			this.deps.openCamera()
		]);
		if (opened.status === 'rejected') return this.fail(opened.reason);
		const camera = opened.value;
		if (started.status === 'rejected') {
			camera.stop();
			return this.fail(started.reason);
		}
		if (this.ended) {
			// Left or skipped meanwhile: the camera was not wanted, and the photo read must not linger.
			camera.stop();
			void this.deps.api.cancel();
			return;
		}
		this.camera = camera;
		if (started.value.max_attempts) this.maxAttempts = started.value.max_attempts;
		if (started.value.reference === 'ready') this.referenceReady = true;
		if (started.value.reference === 'unavailable') {
			// The card gave no usable photo: the verdict call will say why; no need to position.
			return this.finish({ kind: 'skipped', reason: 'no_chip_photo' });
		}
		this.setPhase('positioning');
		await this.position();
	}

	/** The person did not agree. Nothing is read or recorded beyond that fact. */
	decline(): void {
		if (this.phase !== 'consent') return;
		void this.deps.api.cancel();
		this.finish({ kind: 'declined' });
	}

	/**
	 * The person chose to leave the camera step and have staff check instead. Unlike `decline` this
	 * comes after they agreed, so the outcome says so; unlike a timeout it is their own choice.
	 */
	skip(): void {
		if (!this.busy) return;
		void this.deps.api.cancel(FACE_SKIPPED_BY_PERSON);
		this.finish({ kind: 'skipped', reason: FACE_SKIPPED_BY_PERSON });
	}

	/** The page is going away. Wipes an unfinished check; a finished one is kept for the server hand-off. */
	destroy(): void {
		this.stopped = true;
		this.camera?.stop();
		this.camera = null;
		if (this.phase !== 'done') void this.deps.api.cancel();
	}

	private async position(): Promise<void> {
		let startedAt = this.now();
		let streak = 0;
		while (!this.stopped && this.phase === 'positioning' && this.camera) {
			const waited = this.now() - startedAt;
			if (waited > FACE_POSITION_TIMEOUT_MS) {
				return this.finish({ kind: 'skipped', reason: 'timeout' });
			}
			if (waited >= FACE_SLOW_NOTICE_MS) this.slow = true;
			try {
				const reply = await this.deps.api.frame(await this.camera.preview());
				if (this.stopped || this.phase !== 'positioning') return; // left or skipped meanwhile
				if (reply.reference === 'ready') this.referenceReady = true;
				this.frameReady = reply.ready;
				this.showHint(reply.hint, reply.ready);
				streak = reply.ready ? streak + 1 : 0;
			} catch (error) {
				return this.fail(error);
			}
			if (streak >= FACE_READY_STREAK) {
				const verdict = await this.verify();
				if (verdict === 'done' || this.stopped) return;
				streak = 0;
				startedAt = this.now();
				this.slow = false;
			}
			await this.sleep(FACE_PREVIEW_INTERVAL_MS);
		}
	}

	private async verify(): Promise<'again' | 'done'> {
		if (!this.camera) return 'done';
		this.setPhase('verifying');
		let reply: FaceVerifyReply;
		try {
			const frames = await this.camera.burst(FACE_BURST_FRAMES, FACE_BURST_INTERVAL_MS);
			reply = await this.deps.api.verify(frames);
		} catch (error) {
			this.fail(error);
			return 'done';
		}
		if (this.stopped || this.phase === 'done') return 'done'; // left or skipped while verifying
		this.attempt = Math.max(this.attempt, reply.attempt);
		switch (reply.result) {
			case 'match':
				this.finish({ kind: 'match' });
				return 'done';
			case 'not_confirmed':
				this.finish({ kind: 'not_confirmed', reason: reply.reason });
				return 'done';
			case 'skipped':
				this.finish({ kind: 'skipped', reason: reply.reason });
				return 'done';
			case 'retry':
				this.message = faceRetryMessage(reply.hint);
				this.resetHint(reply.hint);
				this.setPhase('positioning');
				// Keep the advice readable: the next preview frame would replace it at once.
				await this.sleep(FACE_RETRY_MESSAGE_MS);
				return 'again';
		}
	}

	/**
	 * Preview hints can flip every frame (too_far, ok, too_far...). Show a new instruction only once
	 * it has repeated, so the sentence does not flicker and the live region is not read out again;
	 * a well-framed frame is shown at once so the person knows to hold still.
	 */
	private showHint(hint: FaceHint, ready: boolean): void {
		if (ready || hint === this.shownHint) {
			this.candidateHint = null;
			this.candidateFrames = 0;
		} else {
			this.candidateFrames = hint === this.candidateHint ? this.candidateFrames + 1 : 1;
			this.candidateHint = hint;
			if (this.candidateFrames < FACE_HINT_CONFIRM_FRAMES) return;
		}
		this.shownHint = hint;
		const message = faceHintMessage(hint);
		if (message !== this.message) this.message = message;
		this.candidateHint = null;
		this.candidateFrames = 0;
	}

	/** A new attempt starts: the advice for it is on screen, and nothing is framed yet. */
	private resetHint(shown: FaceHint): void {
		this.shownHint = shown;
		this.frameReady = false;
		this.candidateHint = null;
		this.candidateFrames = 0;
	}

	/** The camera or the scanner client failed. Tells the scanner client why (for its log) and moves on. */
	private fail(error: unknown): void {
		if (this.phase === 'done') return;
		const reason = classifyFaceFailure(error);
		if (!this.stopped) void this.deps.api.cancel(reason);
		this.finish({ kind: 'unavailable', reason });
	}

	private finish(outcome: FaceCheckOutcome): void {
		if (this.phase === 'done') return;
		this.camera?.stop();
		this.camera = null;
		this.outcome = outcome;
		this.setPhase('done');
		this.deps.onfinish(outcome);
	}

	private setPhase(phase: FaceCheckPhase): void {
		const wasBusy = this.busy;
		this.phase = phase;
		this.frameReady = false;
		if (wasBusy !== this.busy) this.deps.onbusychange?.(this.busy);
	}
}
