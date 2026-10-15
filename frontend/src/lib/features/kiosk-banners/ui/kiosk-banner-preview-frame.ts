export type PreviewFrame = {
	id: 'compact' | 'portrait';
	label: string;
	width: number;
	height: number;
};

/** The two kiosk screens the preview can simulate (FR-KBN-29). */
export const PREVIEW_FRAMES: readonly PreviewFrame[] = [
	{ id: 'compact', label: '1024×600', width: 1024, height: 600 },
	{ id: 'portrait', label: '1080×1920', width: 1080, height: 1920 }
];

const MIN_SCALE = 0.05;

/** Scale that fits `frame` inside `space`: never above 1:1, never zero. */
export function fitScale(
	frame: { width: number; height: number },
	space: { width: number; height: number }
): number {
	const scale = Math.min(space.width / frame.width, space.height / frame.height, 1);
	return Math.max(scale, MIN_SCALE);
}
