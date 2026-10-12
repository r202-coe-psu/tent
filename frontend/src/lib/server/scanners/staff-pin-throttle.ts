import cluster from 'node:cluster';
import type { StaffPinVerifyResult } from './staff-pin';
import {
	STAFF_PIN_ALERT_EVERY,
	STAFF_PIN_MAX_PENDING,
	STAFF_PIN_TURN_TOPIC,
	StaffPinTurns,
	type StaffPinTurnOutcome
} from '../../../../server/staff-pin-turns.mjs';

export { STAFF_PIN_ALERT_EVERY, STAFF_PIN_MAX_PENDING };

/** How long a wrong PIN is held before the kiosk hears back. */
export const STAFF_PIN_WRONG_DELAY_MS = 1000;
/** How long a worker waits for the cluster primary to grant a turn before giving up (→ 503). */
export const STAFF_PIN_TURN_TIMEOUT_MS = 15_000;

/** `busy` = the device's queue is full; the check was not run (→ `429 RATE_LIMITED`). */
export type StaffPinThrottleResult = StaffPinVerifyResult | { kind: 'busy' };

/** A device's turn; `release` lets the next check for that device start. */
export type StaffPinTurnLease = { release: (outcome: StaffPinTurnOutcome) => void };

/** Hands out per-device turns; `null` = the device's queue is full. */
export interface StaffPinTurnGate {
	acquire(deviceId: string): Promise<StaffPinTurnLease | null>;
}

/** Turns kept in this process — single worker and dev. */
export class LocalStaffPinTurnGate implements StaffPinTurnGate {
	private readonly turns: StaffPinTurns;
	private readonly grants = new Map<string, () => void>();
	private seq = 0;

	constructor(warn?: (line: string) => void) {
		this.turns = new StaffPinTurns({ warn });
	}

	async acquire(deviceId: string): Promise<StaffPinTurnLease | null> {
		const turn = { owner: 'local', req: String((this.seq += 1)) };
		const state = this.turns.acquire(deviceId, turn);
		if (state === 'busy') return null;
		if (state === 'queued') {
			await new Promise<void>((resolve) => this.grants.set(turn.req, resolve));
		}
		return {
			release: (outcome) => {
				const next = this.turns.release(deviceId, turn, outcome);
				if (!next) return;
				this.grants.get(next.req)?.();
				this.grants.delete(next.req);
			}
		};
	}
}

type TurnMessage = {
	topic: typeof STAFF_PIN_TURN_TOPIC;
	action: 'acquire' | 'release' | 'granted' | 'busy';
	device: string;
	req: string;
	outcome?: StaffPinTurnOutcome;
};

function isTurnReply(msg: unknown): msg is TurnMessage {
	if (!msg || typeof msg !== 'object') return false;
	const m = msg as Partial<TurnMessage>;
	return (
		m.topic === STAFF_PIN_TURN_TOPIC &&
		(m.action === 'granted' || m.action === 'busy') &&
		typeof m.req === 'string' &&
		typeof m.device === 'string'
	);
}

/**
 * Turns held by the cluster primary (`server/cluster.mjs`), so every worker shares one queue per
 * device. A grant that arrives after this worker gave up is released at once.
 */
export class ClusterStaffPinTurnGate implements StaffPinTurnGate {
	private readonly waiting = new Map<
		string,
		{ resolve: (lease: StaffPinTurnLease | null) => void; timer: ReturnType<typeof setTimeout> }
	>();
	private seq = 0;

	constructor(
		private readonly send: (msg: TurnMessage) => void,
		private readonly timeoutMs = STAFF_PIN_TURN_TIMEOUT_MS
	) {}

	handleMessage(msg: unknown): void {
		if (!isTurnReply(msg)) return;
		const entry = this.waiting.get(msg.req);
		if (!entry) {
			if (msg.action === 'granted') this.releaseTurn(msg.device, msg.req, 'error');
			return;
		}
		this.waiting.delete(msg.req);
		clearTimeout(entry.timer);
		entry.resolve(
			msg.action === 'busy'
				? null
				: { release: (outcome) => this.releaseTurn(msg.device, msg.req, outcome) }
		);
	}

	acquire(deviceId: string): Promise<StaffPinTurnLease | null> {
		const req = String((this.seq += 1));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting.delete(req);
				reject(new Error('Staff PIN turn not granted in time'));
			}, this.timeoutMs);
			this.waiting.set(req, { resolve, timer });
			this.send({ topic: STAFF_PIN_TURN_TOPIC, action: 'acquire', device: deviceId, req });
		});
	}

	private releaseTurn(device: string, req: string, outcome: StaffPinTurnOutcome): void {
		this.send({ topic: STAFF_PIN_TURN_TOPIC, action: 'release', device, req, outcome });
	}
}

export type StaffPinThrottleDeps = {
	sleep?: (ms: number) => Promise<void>;
	warn?: (line: string) => void;
	gate?: StaffPinTurnGate;
};

/**
 * Slows down guessing a device's staff PIN without ever locking the device: one check at a time
 * per device, each wrong PIN held for {@link STAFF_PIN_WRONG_DELAY_MS} before the next may start,
 * and a warning on every {@link STAFF_PIN_ALERT_EVERY} wrong PINs in a row. A device may have at
 * most {@link STAFF_PIN_MAX_PENDING} checks at once (running + waiting); more are answered `busy`
 * at once so piled-up requests cannot grow memory without bound. Under `node:cluster` the turns
 * live in the primary, so these limits are per device across all workers, not per worker. The
 * wrong-PIN count starts again after a right PIN or a restart; it never blocks a check.
 */
export class StaffPinThrottle {
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly gate: StaffPinTurnGate;

	constructor(deps: StaffPinThrottleDeps = {}) {
		this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.gate = deps.gate ?? new LocalStaffPinTurnGate(deps.warn);
	}

	/** Run `check` for `deviceId` once the device's earlier checks (and their delays) are done. */
	async run(
		deviceId: string,
		check: () => Promise<StaffPinVerifyResult>
	): Promise<StaffPinThrottleResult> {
		const lease = await this.gate.acquire(deviceId);
		if (!lease) return { kind: 'busy' };
		let outcome: StaffPinTurnOutcome = 'error';
		try {
			const result = await check();
			outcome = result.kind;
			// Still holding the device's turn, so a queued guess waits out this delay too.
			if (result.kind === 'wrong') await this.sleep(STAFF_PIN_WRONG_DELAY_MS);
			return result;
		} finally {
			lease.release(outcome);
		}
	}
}

function defaultGate(): StaffPinTurnGate {
	if (!cluster.isWorker || typeof process.send !== 'function') return new LocalStaffPinTurnGate();
	const gate = new ClusterStaffPinTurnGate((msg) => {
		try {
			process.send?.(msg);
		} catch {
			// IPC closed — the acquire times out and the route answers 503
		}
	});
	process.on('message', (msg) => gate.handleMessage(msg));
	return gate;
}

export const staffPinThrottle = new StaffPinThrottle({ gate: defaultGate() });
