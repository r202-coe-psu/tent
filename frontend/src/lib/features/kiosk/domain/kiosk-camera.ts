export type CameraDevice = { id: string; label: string };

/** First camera whose label contains `label` (case-insensitive); null → use the default facing. */
export function selectCameraId(
	cameras: readonly CameraDevice[],
	label: string | null
): string | null {
	const wanted = label?.trim().toLowerCase();
	if (!wanted) return null;
	return cameras.find((camera) => camera.label.toLowerCase().includes(wanted))?.id ?? null;
}
