/**
 * One housekeeping call (plan §8). Kept apart from the loop in `print-housekeeping.mjs` so it can be
 * tested with a fake `fetch`.
 *
 * @typedef {{ info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void, error: (...args: unknown[]) => void }} Log
 * @typedef {object} TickDeps
 * @property {string} url full housekeeping endpoint
 * @property {string} token Bearer token (`PRINT_HOUSEKEEPING_TOKEN`); never logged
 * @property {number} timeoutMs abort the request after this long
 * @property {string} okFile written with epoch ms after each 2xx (container healthcheck reads it)
 * @property {typeof fetch} fetch
 * @property {(path: string, data: string) => void} writeFile
 * @property {() => number} now
 * @property {Log} log
 */

/**
 * POST the housekeeping endpoint once. Never throws: a failure is logged (status or error name,
 * never the token or the response body) and reported as `{ ok: false }`.
 *
 * @param {TickDeps} deps
 * @returns {Promise<{ ok: boolean, status?: number }>}
 */
export async function runHousekeepingTick(deps) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
	try {
		const response = await deps.fetch(deps.url, {
			method: 'POST',
			headers: { Authorization: `Bearer ${deps.token}` },
			signal: controller.signal
		});
		if (!response.ok) {
			deps.log.error(`[print-housekeeping] endpoint answered ${response.status}`);
			return { ok: false, status: response.status };
		}
		deps.writeFile(deps.okFile, String(deps.now()));
		return { ok: true, status: response.status };
	} catch (error) {
		deps.log.error(
			`[print-housekeeping] request failed: ${error instanceof Error ? error.name : 'unknown error'}`
		);
		return { ok: false };
	} finally {
		clearTimeout(timer);
	}
}
