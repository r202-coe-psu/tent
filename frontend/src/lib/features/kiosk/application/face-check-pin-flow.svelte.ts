import {
	FACE_BYPASSED_BY_STAFF,
	FACE_MATCH_SHOWN_MS,
	faceOutcomeAction,
	staffPinCancelAction,
	type FaceCheckOutcome,
	type StaffPinOpenedFrom
} from '../domain/face-check';
import type { FaceCheckSession } from './face-check-session.svelte';

/** The parts of the session the PIN flow drives. */
export type FaceCheckPinFlowSession = Pick<FaceCheckSession, 'phase' | 'hold' | 'resume' | 'skip'>;

export type FaceCheckPinFlowDeps = {
	/** Tells the scanner client why a check that had already ended carried on. */
	cancelCheck: (reason: string) => void;
	/** The person may move on (see `KioskFaceCheck`'s `onfinish`). */
	onfinish: (outcome: FaceCheckOutcome) => void;
	/** Staff cancelled the PIN from the result screen: go home, save nothing. */
	oncancel: () => void;
	/** The PIN panel opened or closed (the page pauses its idle timeout meanwhile). */
	onpinchange?: (open: boolean) => void;
};

/** What the page should focus after the PIN panel was cancelled. */
export type FaceCheckPinCancelFocus = 'continue' | 'skip' | null;

/**
 * Where the face check goes once it ends or staff step in: show the match, wait for the staff
 * PIN on a not-matched result, or hand on. Only a match or a staff bypass carries on.
 */
export class FaceCheckPinFlow {
	/**
	 * Where the staff PIN panel was opened from: the camera (cancel resumes the check) or the result
	 * screen after the check ended (cancel goes home). Closed = null.
	 */
	pinFrom = $state<StaffPinOpenedFrom | null>(null);
	/** onfinish has been called: nothing more to show while the page moves on. */
	handedOn = $state(false);

	#session: FaceCheckPinFlowSession | null = null;
	#matchTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly deps: FaceCheckPinFlowDeps) {}

	/** The session is created with `finished` as its `onfinish`, so it is attached afterwards. */
	attach(session: FaceCheckPinFlowSession): void {
		this.#session = session;
	}

	get pinOpen(): boolean {
		return this.pinFrom !== null;
	}

	/** The session ended. */
	finished(outcome: FaceCheckOutcome): void {
		switch (faceOutcomeAction(outcome)) {
			case 'hand_on':
				return this.#handOn(outcome);
			case 'show_match':
				this.#setPinFrom(null);
				this.#matchTimer = setTimeout(() => this.#handOn(outcome), FACE_MATCH_SHOWN_MS);
				return;
			case 'close_pin':
				this.#setPinFrom(null);
				return;
			case 'wait_for_pin':
				// The PIN panel, if open, stays open; otherwise the result screen asks.
				return;
		}
	}

	/** "Staff skip this step" at the camera: hold the check and ask for the staff PIN. */
	skip(): void {
		const session = this.#requireSession();
		session.hold();
		this.#setPinFrom('camera');
	}

	/** "Staff carry on" on the not-matched result screen. */
	openFromResult(): void {
		this.#setPinFrom('result');
	}

	pinVerified(): void {
		const session = this.#requireSession();
		if (session.phase !== 'done') {
			// Ends the check as a staff bypass; `finished` hands it on.
			session.skip(FACE_BYPASSED_BY_STAFF);
			return;
		}
		// The check had already ended: only the scanner client's log learns why it carried on.
		this.deps.cancelCheck(FACE_BYPASSED_BY_STAFF);
		this.#handOn({ kind: 'skipped', reason: FACE_BYPASSED_BY_STAFF });
	}

	/** Cancel, Esc or 30 s idle on the PIN panel. Returns which button the page should focus. */
	pinCancelled(): FaceCheckPinCancelFocus {
		const from = this.pinFrom;
		if (!from) return null;
		const session = this.#requireSession();
		this.#setPinFrom(null);
		switch (staffPinCancelAction(from, session.phase === 'done')) {
			case 'go_home':
				this.deps.oncancel();
				return null;
			case 'show_result':
				// Ended meanwhile: the result screen asks again.
				return 'continue';
			case 'resume':
				session.resume();
				return 'skip';
		}
	}

	destroy(): void {
		if (this.#matchTimer) clearTimeout(this.#matchTimer);
		this.#matchTimer = null;
	}

	#handOn(outcome: FaceCheckOutcome): void {
		this.handedOn = true;
		this.#setPinFrom(null);
		this.deps.onfinish(outcome);
	}

	#setPinFrom(from: StaffPinOpenedFrom | null): void {
		this.pinFrom = from;
		this.deps.onpinchange?.(from !== null);
	}

	#requireSession(): FaceCheckPinFlowSession {
		if (!this.#session) throw new Error('FaceCheckPinFlow: attach a session first');
		return this.#session;
	}
}
