import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { runHousekeepingTick } from './print-housekeeping-tick.mjs';

/**
 * Print-queue housekeeping loop (plan §8): every PRINT_HOUSEKEEPING_INTERVAL_MS it POSTs the
 * internal housekeeping endpoint of the frontend. Run as its own container so the work no longer
 * piggybacks on a request-serving process. After each 2xx it writes epoch ms to the OK file, which
 * the container healthcheck reads.
 */

const baseUrl = (process.env.PRINT_HOUSEKEEPING_URL || 'http://frontend:3000').replace(/\/$/, '');
const token = process.env.PRINT_HOUSEKEEPING_TOKEN;
const okFile = process.env.PRINT_HOUSEKEEPING_OK_FILE || '/tmp/print-housekeeping.ok';
const endpoint = `${baseUrl}/api/internal/printers/housekeeping`;
const parsedIntervalMs = Number(process.env.PRINT_HOUSEKEEPING_INTERVAL_MS);
const intervalMs =
	Number.isFinite(parsedIntervalMs) && parsedIntervalMs >= 1000 ? parsedIntervalMs : 30_000;
const TIMEOUT_MS = 25_000;

if (!token) {
	console.error('[print-housekeeping] PRINT_HOUSEKEEPING_TOKEN is required');
	process.exit(1);
}

let stopping = false;
let wake = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		stopping = true;
		console.info(`[print-housekeeping] received ${signal}; stopping after current request`);
		wake?.();
	});
}

/** Sleep that a stop signal cuts short. */
const sleep = (ms) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		wake = () => {
			clearTimeout(timer);
			resolve();
		};
	});

console.info(`[print-housekeeping] posting ${endpoint} every ${intervalMs} ms`);
while (!stopping) {
	await runHousekeepingTick({
		url: endpoint,
		token,
		timeoutMs: TIMEOUT_MS,
		okFile,
		fetch,
		writeFile: writeFileSync,
		now: Date.now,
		log: console
	});
	if (!stopping) await sleep(intervalMs);
}

console.info('[print-housekeeping] stopped');
