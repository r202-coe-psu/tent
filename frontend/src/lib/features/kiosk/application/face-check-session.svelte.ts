import { SvelteDate } from 'svelte/reactivity';
import type { KioskFaceApi } from '../data/kiosk-face.api';
import {
	FACE_BURST_FRAMES,
	FACE_BURST_INTERVAL_MS,
	FACE_POSITION_TIMEOUT_MS,
	FACE_PREVIEW_INTERVAL_MS,
	FACE_READY_STREAK,
	FACE_RETRY_MESSAGE_MS,
	faceHintMessage,
	faceRetryMessage,
	type FaceCheckFlow,
	type FaceCheckOutcome,
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

	private camera: FaceCamera | null = null;
	private stopped = false;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly now: () => number;

	constructor(private readonly deps: FaceCheckSessionDeps) {
		this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.now = deps.now ?? Date.now;
	}

	get busy(): boolean {
		return BUSY_PHASES.includes(this.phase);
	}

	/** The person agreed: start the check on the scanner client and open the camera. */
	async agree(): Promise<void> {
		if (this.phase !== 'consent') return;
		this.consentedAt = new SvelteDate(this.now()).toISOString();
		this.setPhase('starting');
		try {
			const [started, camera] = await Promise.all([
				this.deps.api.start(this.deps.citizenId, this.deps.flow),
				this.deps.openCamera()
			]);
			this.camera = camera;
			if (this.stopped) return camera.stop();
			if (started.reference === 'unavailable') {
				// The card gave no usable photo: the verdict call will say why; no need to position.
				return this.finish({ kind: 'skipped', reason: 'no_chip_photo' });
			}
		} catch {
			return this.finish({ kind: 'unavailable' });
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
			if (this.now() - startedAt > FACE_POSITION_TIMEOUT_MS) {
				return this.finish({ kind: 'skipped', reason: 'timeout' });
			}
			try {
				const reply = await this.deps.api.frame(await this.camera.preview());
				if (this.stopped) return;
				this.message = faceHintMessage(reply.hint);
				streak = reply.ready ? streak + 1 : 0;
			} catch {
				return this.finish({ kind: 'unavailable' });
			}
			if (streak >= FACE_READY_STREAK) {
				const verdict = await this.verify();
				if (verdict === 'done' || this.stopped) return;
				streak = 0;
				startedAt = this.now();
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
		} catch {
			this.finish({ kind: 'unavailable' });
			return 'done';
		}
		if (this.stopped) return 'done';
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
				this.setPhase('positioning');
				// Keep the advice readable: the next preview frame would replace it at once.
				await this.sleep(FACE_RETRY_MESSAGE_MS);
				return 'again';
		}
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
		if (wasBusy !== this.busy) this.deps.onbusychange?.(this.busy);
	}
}
