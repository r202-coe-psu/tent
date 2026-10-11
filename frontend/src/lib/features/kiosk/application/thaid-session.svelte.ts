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

/** Only "try again later" failures keep a poll going; the rest are final. */
function isRetryable(error: KioskThaidError): boolean {
	return error.kind === 'unavailable' || error.kind === 'rate_limited';
}

/**
 * One kiosk ThaiD scan: create a session (QR) → poll its status every 2 s until the phone has
 * confirmed (`completed`, which exposes `gate` for lookup / check-in), or the QR `expired` /
 * was `cancelled` (replaced by a newer one), or creating it failed (`error`).
 *
 * Polling never overlaps (the next tick is scheduled when the previous answer arrived). A network
 * blip / timeout / 5xx / 429 is retried until the QR expires; any other 4xx is final (`error`).
 *
 * The deadline is the server's "seconds left" (`expires_in_sec`) added to the kiosk's monotonic
 * clock (`performance.now()`) when each answer arrives, so a kiosk wall clock that is wrong or gets
 * corrected never ends a QR early or keeps it alive. When the deadline passes, one last status call
 * decides: a confirmation in the final seconds is kept (`completed`), anything else is `expired`.
 */
export class ThaidSession {
	state = $state<ThaidSessionState>('idle');
	sessionId = $state<string | null>(null);
	qrUrl = $state<string | null>(null);
	/** When the QR stops being valid, in `performance.now()` ms (monotonic, not the wall clock). */
	deadline = $state<number | null>(null);
	errorKind = $state<KioskThaidErrorKind | null>(null);
	retryAfterSeconds = $state<number | null>(null);

	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private expiryTimer: ReturnType<typeof setTimeout> | null = null;
	/** Identifies the latest status call; an older answer that arrives late is dropped. */
	private pollSeq = 0;
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
		this.deadline = null;
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
		this.state = 'pending';
		this.setDeadline(created);
		this.schedulePoll();
	}

	/**
	 * (Re)arm the deadline from a server answer: its relative `expiresInSec` first; the absolute
	 * `expiresAt` (server clock, so only meaningful if the kiosk clock agrees) just as a fallback.
	 */
	private setDeadline(reply: { expiresInSec?: number; expiresAt?: number }): void {
		const mono = performance.now();
		let remainingMs: number;
		if (reply.expiresInSec !== undefined) remainingMs = reply.expiresInSec * 1000;
		else if (reply.expiresAt !== undefined) remainingMs = reply.expiresAt - Date.now();
		else return;
		remainingMs = Math.max(0, remainingMs);
		this.deadline = mono + remainingMs;
		if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
		const generation = this.generation;
		this.expiryTimer = setTimeout(() => void this.finalPoll(generation), remainingMs);
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
		const seq = ++this.pollSeq;
		let reply: KioskThaidStatusResult;
		try {
			reply = await this.api.getStatus(this.sessionId);
		} catch (error) {
			if (!this.isCurrent(generation) || seq !== this.pollSeq) return;
			// A blip (network, timeout, 5xx, 429) is retried on the next tick until the QR expires; any
			// other 4xx (switched off, not authorised, bad request) cannot get better by asking again.
			if (error instanceof KioskThaidError && !isRetryable(error)) this.fail(error);
			else this.schedulePoll();
			return;
		}
		if (!this.isCurrent(generation) || seq !== this.pollSeq) return;
		if (this.settle(reply)) return;
		this.setDeadline(reply);
		this.schedulePoll();
	}

	/** The deadline passed: ask the server once more so a late confirmation is not lost. */
	private async finalPoll(generation: number): Promise<void> {
		this.expiryTimer = null;
		if (!this.isCurrent(generation) || !this.sessionId) return;
		if (this.pollTimer !== null) clearTimeout(this.pollTimer);
		this.pollTimer = null;
		const seq = ++this.pollSeq;
		let reply: KioskThaidStatusResult | null = null;
		try {
			reply = await this.api.getStatus(this.sessionId);
		} catch {
			// Nothing more to wait for: the QR is past its deadline either way.
		}
		if (!this.isCurrent(generation) || seq !== this.pollSeq) return;
		if (reply && this.settle(reply)) return;
		this.finish('expired');
	}

	/** Apply a terminal status; false while the session is still waiting for the scan. */
	private settle(reply: KioskThaidStatusResult): boolean {
		if (reply.status === 'completed') this.finish('completed');
		else if (reply.status === 'cancelled') this.finish('cancelled');
		else if (reply.status === 'expired' || reply.status === 'consumed') this.finish('expired');
		else return false;
		return true;
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
