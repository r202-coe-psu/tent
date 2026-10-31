/**
 * Shared, cross-process lease on the global `config:app.recaptcha_enabled` switch.
 *
 * Suites that book through the real public gate (donation full-stack, pre-register writes) need
 * reCAPTCHA OFF for the duration of their run — a fake token never passes Google verification.
 * The switch is one global CouchDB doc, and the staging config runs two workers, so suite A's
 * "restore" used to turn it back ON underneath suite B. Every such suite now takes a lease:
 *
 *   - the FIRST holder reads the original state, saves it and turns the switch off;
 *   - later holders just join (the switch is already off);
 *   - the LAST holder to release restores the original state.
 *
 * State lives in `node_modules/.cache/e2e-recaptcha/` (workers are separate processes and are
 * restarted after a failed serial test, so module state would not do). Every read-modify-write
 * runs under a mkdir-based mutex. Holders are tied to a pid: a holder whose process is gone
 * (a crashed run) is pruned, and the original saved by that run is kept, so the next run still
 * restores the real original instead of the crashed run's "off".
 */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Browser } from '@playwright/test';
import { bootstrapAdminSession } from './couch';
import { injectSession, routeBrowserCouchThroughApp } from './login';
import { setRecaptcha } from './staff-ui';

const DIR = 'node_modules/.cache/e2e-recaptcha';
const STATE_PATH = `${DIR}/state.json`;
const LOCK_PATH = `${DIR}/lock`;
/** A lock older than this was left by a killed process (toggling takes seconds, not minutes). */
const LOCK_STALE_MS = 3 * 60_000;
const LOCK_WAIT_MS = 5 * 60_000;

interface Holder {
	id: string;
	pid: number;
}
interface State {
	/** The switch's state before the first holder turned it off; `null` when no lease is live. */
	original: boolean | null;
	holders: Holder[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: the process exists but is not ours
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
	mkdirSync(DIR, { recursive: true });
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try {
			mkdirSync(LOCK_PATH);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			try {
				if (Date.now() - statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) {
					rmSync(LOCK_PATH, { recursive: true, force: true });
					continue;
				}
			} catch {
				continue; // released between mkdir and stat — retry at once
			}
			if (Date.now() > deadline)
				throw new Error('timed out waiting for the reCAPTCHA lease lock', { cause: error });
			await sleep(250);
		}
	}
	try {
		return await fn();
	} finally {
		rmSync(LOCK_PATH, { recursive: true, force: true });
	}
}

function readState(): State {
	try {
		const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Partial<State>;
		return { original: raw.original ?? null, holders: raw.holders ?? [] };
	} catch {
		return { original: null, holders: [] };
	}
}

function writeState(state: State): void {
	if (state.holders.length === 0 && state.original === null) {
		rmSync(STATE_PATH, { force: true });
		return;
	}
	mkdirSync(dirname(STATE_PATH), { recursive: true });
	writeFileSync(STATE_PATH, JSON.stringify(state));
}

/**
 * Take a lease on "reCAPTCHA off". Call once the spec knows it will run and always await the
 * returned release in `afterAll`; the last release restores the switch to what it was before
 * the first lease.
 */
export async function suspendRecaptcha(browser: Browser): Promise<() => Promise<void>> {
	const admin = await bootstrapAdminSession();
	const context = await browser.newContext();
	const closeContext = async () => {
		// Drop the routes first so an in-flight `_changes` long-poll cannot reject close().
		await Promise.all(context.pages().map((p) => p.unrouteAll({ behavior: 'ignoreErrors' })));
		await context.close();
	};
	const me: Holder = { id: `${process.pid}-${Date.now()}-${Math.random()}`, pid: process.pid };
	try {
		const page = await context.newPage();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);

		await withLock(async () => {
			const state = readState();
			const live = state.holders.filter((h) => isAlive(h.pid));
			if (live.length === 0) {
				// First holder — or the only ones left are dead: keep an `original` a crashed run saved.
				const before = await setRecaptcha(page, false);
				state.original = state.original ?? before;
			}
			writeState({ original: state.original, holders: [...live, me] });
		});

		return async () => {
			try {
				await withLock(async () => {
					const state = readState();
					const rest = state.holders.filter((h) => h.id !== me.id && isAlive(h.pid));
					if (rest.length === 0) {
						await setRecaptcha(page, state.original ?? true);
						writeState({ original: null, holders: [] });
					} else {
						writeState({ original: state.original, holders: rest });
					}
				});
			} finally {
				await closeContext();
			}
		};
	} catch (error) {
		await closeContext().catch(() => undefined);
		throw error;
	}
}
