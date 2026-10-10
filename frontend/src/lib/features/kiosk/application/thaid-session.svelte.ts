import {
	KioskThaidError,
	type KioskThaidErrorKind,
	type KioskThaidSession,
	type KioskThaidStatusResult
} from '../data/kiosk-thaid.api';
import type { GateInput } from '../data/kiosk-check-in.api';

export type ThaidSessionState =
	'idle' | 'creating' | 'pending' | 'completed' | 'expired' | 'cancelled' | 'error';

/** The three kiosk ThaiD calls, injected so the state machine never touches `fetch`. */
export interface ThaidSessionApi {
	create(): Promise<KioskThaidSession>;
	getStatus(sessionId: string): Promise<KioskThaidStatusResult>;
	cancel(sessionId: string): Promise<void>;
}

export const THAID_POLL_INTERVAL_MS = 2000;

/**
 * One kiosk ThaiD scan: create a session (QR) → poll its status every 2 s until the phone has
 * confirmed (`completed`, which exposes `gate` for lookup / check-in), or the QR `expired` /
 * was `cancelled` (replaced by a newer one), or creating it failed (`error`).
 *
 * Polling never overlaps (the next tick is scheduled when the previous answer arrived), and a
 * network blip is retried until the QR expires. The local clock also ends the wait at `expiresAt`
 * so the screen flips without waiting for a poll.
 */
export class ThaidSession {
	state = $state<ThaidSessionState>('idle');
	sessionId = $state<string | null>(null);
	qrUrl = $state<string | null>(null);
	/** Unix ms. */
	expiresAt = $state<number | null>(null);
	errorKind = $state<KioskThaidErrorKind | null>(null);
	retryAfterSeconds = $state<number | null>(null);

	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private expiryTimer: ReturnType<typeof setTimeout> | null = null;
	/** Bumped on every start / restart / destroy so an answer for a replaced session is dropped. */
	private generation = 0;

	constructor(private readonly api: ThaidSessionApi) {}

	/** The ThaiD gate for lookup / check-in; set only once the phone has confirmed. */
	get gate(): Extract<GateInput, { source: 'thaid' }> | null {
		return this.state === 'completed' && this.sessionId
			? { source: 'thaid', session_id: this.sessionId }
			: null;
	}

	start(): Promise<void> {
		return this.begin();
	}

	/** A fresh QR after expiry / error; a session still waiting (or completed) is cancelled first. */
	restart(): Promise<void> {
		this.release();
		return this.begin();
	}

	/**
	 * Call when leaving the page, for any reason. Stops the timers and cancels a session that is
	 * still waiting for the scan or was completed (even if its identity was already handed to
	 * lookup / check-in: cancelling a consumed session is a harmless no-op on the server, and cancelling
	 * an unconsumed one burns the verified identity). Sessions the server already ended are not cancelled.
	 */
	destroy(): void {
		this.release();
		this.generation += 1;
	}

	private async begin(): Promise<void> {
		const generation = ++this.generation;
		this.clearTimers();
		this.sessionId = null;
		this.qrUrl = null;
		this.expiresAt = null;
		this.errorKind = null;
		this.retryAfterSeconds = null;
		this.state = 'creating';
		let created: KioskThaidSession;
		try {
			created = await this.api.create();
		} catch (error) {
			if (generation === this.generation) this.fail(error);
			return;
		}
		if (generation !== this.generation) {
			// The page was left (or restarted) while the QR was being made: do not leave it dangling.
			void this.api.cancel(created.sessionId);
			return;
		}
		this.sessionId = created.sessionId;
		this.qrUrl = created.qrUrl;
		this.expiresAt = created.expiresAt;
		this.state = 'pending';
		this.schedulePoll();
		this.expiryTimer = setTimeout(
			() => this.finish('expired'),
			Math.max(0, created.expiresAt - Date.now())
		);
	}

	/** Stop timers and cancel the server session when it is still live (pending or completed). */
	private release(): void {
		this.clearTimers();
		if ((this.state === 'pending' || this.state === 'completed') && this.sessionId) {
			void this.api.cancel(this.sessionId);
		}
	}

	private schedulePoll(): void {
		if (this.pollTimer !== null) clearTimeout(this.pollTimer);
		const generation = this.generation;
		this.pollTimer = setTimeout(() => void this.poll(generation), THAID_POLL_INTERVAL_MS);
	}

	private clearTimers(): void {
		if (this.pollTimer !== null) clearTimeout(this.pollTimer);
		if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
		this.pollTimer = null;
		this.expiryTimer = null;
	}

	private isCurrent(generation: number): boolean {
		return generation === this.generation && this.state === 'pending';
	}

	/** One poll at a time: the next one is scheduled only after this one has settled. */
	private async poll(generation: number): Promise<void> {
		this.pollTimer = null;
		if (!this.isCurrent(generation) || !this.sessionId) return;
		let reply: KioskThaidStatusResult;
		try {
			reply = await this.api.getStatus(this.sessionId);
		} catch (error) {
			if (!this.isCurrent(generation)) return;
			// A blip (timeout, 5xx) is retried on the next tick until the QR expires; only a switched-off
			// method is final.
			if (error instanceof KioskThaidError && error.kind === 'disabled') this.fail(error);
			else this.schedulePoll();
			return;
		}
		if (!this.isCurrent(generation)) return;
		if (reply.status === 'completed') return this.finish('completed');
		if (reply.status === 'cancelled') return this.finish('cancelled');
		if (reply.status === 'expired' || reply.status === 'consumed') return this.finish('expired');
		this.schedulePoll();
	}

	private fail(error: unknown): void {
		this.clearTimers();
		this.state = 'error';
		this.errorKind = error instanceof KioskThaidError ? error.kind : 'unavailable';
		this.retryAfterSeconds = error instanceof KioskThaidError ? error.retryAfterSeconds : null;
	}

	/** Leave `pending` for good: nothing is polled or timed any more. */
	private finish(state: 'completed' | 'expired' | 'cancelled'): void {
		if (this.state !== 'pending') return;
		this.clearTimers();
		this.state = state;
	}
}
