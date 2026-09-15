import { randomUUID } from 'node:crypto';
import process from 'node:process';

const baseUrl = (process.env.SHELTER_IMPORT_WORKER_URL || 'http://frontend:3000').replace(
	/\/$/,
	''
);
const token = process.env.SHELTER_IMPORT_WORKER_TOKEN;
const workerId =
	process.env.SHELTER_IMPORT_WORKER_ID || `import-worker-${process.pid}-${randomUUID()}`;
const endpoint = `${baseUrl}/api/internal/shelter-import/worker/next`;
const pollMs = Math.max(3000, Number(process.env.SHELTER_IMPORT_WORKER_POLL_MS || 3000));
const timeoutMs = Math.max(10_000, Number(process.env.SHELTER_IMPORT_WORKER_TIMEOUT_MS || 120_000));

if (!token) {
	console.error('[shelter-import-worker] SHELTER_IMPORT_WORKER_TOKEN is required');
	process.exit(1);
}

let stopping = false;
let activeController = null;
let shutdownTimer = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		stopping = true;
		console.info(`[shelter-import-worker] received ${signal}; stopping after current item`);
		if (activeController && !shutdownTimer) {
			shutdownTimer = setTimeout(() => {
				console.warn('[shelter-import-worker] shutdown grace period expired; aborting item');
				activeController?.abort();
			}, 30_000);
		}
	});
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processOne() {
	const controller = new AbortController();
	activeController = controller;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'x-shelter-import-worker-id': workerId
			},
			signal: controller.signal
		});
		if (response.status === 204) return false;
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`worker endpoint ${response.status}: ${body.slice(0, 500)}`);
		}
		const result = await response.json();
		console.info(
			`[shelter-import-worker] processed ${result.itemId ?? 'item'} ` +
				`job=${result.jobId ?? 'unknown'}`
		);
		return true;
	} finally {
		clearTimeout(timer);
		activeController = null;
		if (shutdownTimer) {
			clearTimeout(shutdownTimer);
			shutdownTimer = null;
		}
	}
}

console.info(`[shelter-import-worker] polling ${endpoint} as ${workerId}`);
let errorBackoffMs = 1000;
while (!stopping) {
	try {
		await processOne();
		errorBackoffMs = 1000;
	} catch (error) {
		console.error('[shelter-import-worker] poll failed', error);
		await sleep(errorBackoffMs);
		errorBackoffMs = Math.min(errorBackoffMs * 2, 5000);
		continue;
	}
	if (!stopping) await sleep(pollMs);
}

console.info('[shelter-import-worker] stopped');
