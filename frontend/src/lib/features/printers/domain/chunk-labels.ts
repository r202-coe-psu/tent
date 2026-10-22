import { MAX_LABELS_PER_JOB } from './print-job.schema';

/** Split labels into jobs of at most `size` (default: the per-job cap), keeping order (plan §8). */
export function chunkLabels<T>(labels: readonly T[], size: number = MAX_LABELS_PER_JOB): T[][] {
	if (!(size >= 1)) throw new RangeError('chunk size must be at least 1');
	const chunks: T[][] = [];
	for (let i = 0; i < labels.length; i += size) chunks.push(labels.slice(i, i + size));
	return chunks;
}
