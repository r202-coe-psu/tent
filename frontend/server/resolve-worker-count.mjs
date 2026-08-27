/** Default when WEB_CONCURRENCY is unset or invalid. */
export const DEFAULT_WEB_CONCURRENCY = 3;

/**
 * Resolve how many Node cluster workers to run.
 *
 * @param {string | undefined | null} envValue raw `WEB_CONCURRENCY`
 * @param {number} availableCpus from `os.availableParallelism()` (or test double)
 * @returns {number} at least 1, at most `availableCpus`, default {@link DEFAULT_WEB_CONCURRENCY}
 */
export function resolveWorkerCount(envValue, availableCpus) {
	const cpus = Math.max(1, Math.floor(Number(availableCpus)) || 1);
	let requested = DEFAULT_WEB_CONCURRENCY;

	if (envValue !== undefined && envValue !== null && String(envValue).trim() !== '') {
		const n = Number.parseInt(String(envValue).trim(), 10);
		if (Number.isFinite(n) && n > 0) {
			requested = n;
		}
	}

	return Math.max(1, Math.min(requested, cpus));
}
