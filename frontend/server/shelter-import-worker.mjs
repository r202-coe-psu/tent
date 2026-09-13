import process from 'node:process';

const baseUrl = (process.env.SHELTER_IMPORT_WORKER_URL || 'http://frontend:3000').replace(
	/\/$/,
	''
);
const token = process.env.SHELTER_IMPORT_WORKER_TOKEN;
const workerId = process.env.SHELTER_IMPORT_WORKER_ID || `import-worker-${process.pid}`;
const endpoint = `${baseUrl}/api/back-office/shelter-import/worker/next`;
const pollMs = Math.max(250, Number(process.env.SHELTER_IMPORT_WORKER_POLL_MS || 1000));
const timeoutMs = Math.max(10_000, Number(process.env.SHELTER_IMPORT_WORKER_TIMEOUT_MS || 120_000));

if (!token) {
	console.error('[shelter-import-worker] SHELTER_IMPORT_WORKER_TOKEN is required');
	process.exit(1);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		stopping = true;
		console.info(`[shelter-import-worker] received ${signal}; stopping after current item`);
	});
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processOne() {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'x-shelter-import-worker-token': token,
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
	}
}

console.info(`[shelter-import-worker] polling ${endpoint} as ${workerId}`);
while (!stopping) {
	try {
		await processOne();
	} catch (error) {
		console.error('[shelter-import-worker] poll failed', error);
		await sleep(Math.min(pollMs * 5, 5000));
		continue;
	}
	if (!stopping) await sleep(pollMs);
}

console.info('[shelter-import-worker] stopped');
