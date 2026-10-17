/**
 * Per-device turns for kiosk staff-PIN checks.
 *
 * One device gets one check at a time, at most {@link STAFF_PIN_MAX_PENDING} checks at once
 * (running + waiting), and a warning on every {@link STAFF_PIN_ALERT_EVERY} wrong PINs in a row.
 * Under `node:cluster` the primary (`cluster.mjs`) holds the only instance and workers ask it for a
 * turn over IPC ({@link STAFF_PIN_TURN_TOPIC}), so the limit holds across every worker rather than
 * per worker. Without cluster, `staff-pin-throttle.ts` keeps an instance in-process.
 *
 * Pure bookkeeping: no timers, no IPC. Callers deliver the grants this returns.
 */

/** IPC topic between cluster workers and the primary. */
export const STAFF_PIN_TURN_TOPIC = 'staff-pin-turn';
/** Checks one device may have at once: the one running plus one waiting. */
export const STAFF_PIN_MAX_PENDING = 2;
/** Warn on every this-many wrong PINs in a row from one device. */
export const STAFF_PIN_ALERT_EVERY = 5;

/**
 * @typedef {{ owner: string | number, req: string }} StaffPinTurn
 *   `owner` = cluster worker id (or `'local'`), `req` = request id unique within that owner.
 * @typedef {'ok' | 'wrong' | 'not_set' | 'error'} StaffPinTurnOutcome
 */

/**
 * @param {StaffPinTurn | null} a
 * @param {StaffPinTurn} b
 */
function sameTurn(a, b) {
	return a !== null && a.owner === b.owner && a.req === b.req;
}

export class StaffPinTurns {
	/** @type {Map<string, { holder: StaffPinTurn | null, waiting: StaffPinTurn[] }>} */
	#devices = new Map();
	/** @type {Map<string, number>} */
	#wrongInARow = new Map();
	/** @type {(line: string) => void} */
	#warn;

	/** @param {{ warn?: (line: string) => void }} [deps] */
	constructor(deps = {}) {
		this.#warn = deps.warn ?? ((line) => console.warn(line));
	}

	/**
	 * Ask for `device`'s turn.
	 * @param {string} device
	 * @param {StaffPinTurn} turn
	 * @returns {'granted' | 'queued' | 'busy'} `queued` turns are returned later by {@link release}.
	 */
	acquire(device, turn) {
		const state = this.#devices.get(device) ?? { holder: null, waiting: [] };
		const pending = (state.holder ? 1 : 0) + state.waiting.length;
		if (pending >= STAFF_PIN_MAX_PENDING) return 'busy';
		this.#devices.set(device, state);
		if (!state.holder) {
			state.holder = turn;
			return 'granted';
		}
		state.waiting.push(turn);
		return 'queued';
	}

	/**
	 * End `turn` (a no-op unless it holds `device`) and record its outcome.
	 * @param {string} device
	 * @param {StaffPinTurn} turn
	 * @param {StaffPinTurnOutcome} outcome
	 * @returns {StaffPinTurn | null} the waiting turn that now holds the device — grant it.
	 */
	release(device, turn, outcome) {
		const state = this.#devices.get(device);
		if (!state || !sameTurn(state.holder, turn)) return null;
		this.#record(device, outcome);
		return this.#advance(device, state);
	}

	/**
	 * Forget every turn of an owner that went away (a cluster worker that exited).
	 * @param {string | number} owner
	 * @returns {{ device: string, turn: StaffPinTurn }[]} turns that now hold their device.
	 */
	dropOwner(owner) {
		/** @type {{ device: string, turn: StaffPinTurn }[]} */
		const grants = [];
		for (const [device, state] of this.#devices) {
			state.waiting = state.waiting.filter((turn) => turn.owner !== owner);
			if (state.holder?.owner === owner) {
				const next = this.#advance(device, state);
				if (next) grants.push({ device, turn: next });
			} else if (!state.holder && state.waiting.length === 0) {
				this.#devices.delete(device);
			}
		}
		return grants;
	}

	/**
	 * @param {string} device
	 * @param {{ holder: StaffPinTurn | null, waiting: StaffPinTurn[] }} state
	 */
	#advance(device, state) {
		state.holder = state.waiting.shift() ?? null;
		if (!state.holder) this.#devices.delete(device);
		return state.holder;
	}

	/**
	 * @param {string} device
	 * @param {StaffPinTurnOutcome} outcome
	 */
	#record(device, outcome) {
		if (outcome === 'ok') {
			this.#wrongInARow.delete(device);
			return;
		}
		if (outcome !== 'wrong') return;
		const count = (this.#wrongInARow.get(device) ?? 0) + 1;
		this.#wrongInARow.set(device, count);
		if (count % STAFF_PIN_ALERT_EVERY === 0) {
			this.#warn(
				`[scanner-staff-pin] repeated wrong PINs device=${device} consecutive=${count} at=${new Date().toISOString()}`
			);
		}
	}
}
