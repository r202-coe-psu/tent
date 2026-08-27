/**
 * Production entry for adapter-node behind node:cluster.
 *
 * - WEB_CONCURRENCY (default 3) selects worker count, clamped to available CPUs.
 * - When the resolved count is 1, skips cluster and loads the SvelteKit server directly.
 * - Workers share the TCP listen port (do not set SOCKET_PATH with this entrypoint).
 *
 * Scale map (where to turn the dial):
 * 1. Frontend Node — this file / WEB_CONCURRENCY (BFF + SPA in one container)
 * 2. FastAPI — public/external API (uvicorn workers separately)
 * 3. Docker replicas + nginx upstream — when one host / one container is not enough
 * 4. CouchDB / Mongo — data plane; more Node workers will not help a DB bottleneck
 */
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import process from 'node:process';
import { resolveWorkerCount } from './resolve-worker-count.mjs';

const cpus = availableParallelism();
const raw = process.env.WEB_CONCURRENCY;
const workers = resolveWorkerCount(raw, cpus);

async function startServer() {
	await import('../build/index.js');
}

if (workers === 1) {
	if (raw !== undefined && String(raw).trim() !== '' && String(raw).trim() !== '1') {
		console.info(
			`[cluster] WEB_CONCURRENCY=${raw} clamped to 1 worker (cpus=${cpus}); running without cluster`
		);
	}
	await startServer();
} else if (cluster.isPrimary) {
	let shuttingDown = false;

	console.info(
		`[cluster] primary ${process.pid}: starting ${workers} workers` +
			` (WEB_CONCURRENCY=${raw ?? 'default'}, cpus=${cpus})`
	);

	for (let i = 0; i < workers; i++) {
		cluster.fork();
	}

	cluster.on('exit', (worker, code, signal) => {
		if (shuttingDown) return;
		console.warn(
			`[cluster] worker ${worker.process.pid} exited (${signal || code}); restarting`
		);
		cluster.fork();
	});

	const shutdown = (signal) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.info(`[cluster] primary received ${signal}; stopping workers`);

		const live = Object.values(cluster.workers ?? {}).filter(Boolean);
		if (live.length === 0) {
			process.exit(0);
			return;
		}

		let exited = 0;
		const done = () => {
			exited += 1;
			if (exited >= live.length) process.exit(0);
		};
		cluster.on('exit', done);

		for (const w of live) {
			w.process.kill(signal);
		}

		// adapter-node SHUTDOWN_TIMEOUT defaults to 30s — give a little headroom
		setTimeout(() => {
			console.error('[cluster] shutdown timed out; forcing exit');
			process.exit(1);
		}, 35_000).unref();
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
} else {
	await startServer();
}
