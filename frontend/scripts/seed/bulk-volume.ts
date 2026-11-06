/** Shared by the bulk seed / unseed scripts: warn before a run big enough to flood the sync worker. */
export const LARGE_VOLUME_THRESHOLD = 10_000;

export const LARGE_VOLUME_WARNING =
	'  ! large volume: the sync worker re-projects every change; stop sync-worker first and run ' +
	'`uv run --project worker sync-worker --bootstrap` afterwards (see README)';

export function isLargeVolume(n: number): boolean {
	return n > LARGE_VOLUME_THRESHOLD;
}
