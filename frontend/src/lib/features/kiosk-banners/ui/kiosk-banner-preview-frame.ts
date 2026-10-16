import {
	KIOSK_SCREENS,
	KIOSK_SCREEN_TYPES,
	type KioskScreenType
} from '$lib/features/shared/domain/kiosk-screen';

export type PreviewFrame = {
	id: KioskScreenType;
	label: string;
	width: number;
	height: number;
};

/** The two kiosk screens the preview can simulate (FR-KBN-29). */
export const PREVIEW_FRAMES: readonly PreviewFrame[] = KIOSK_SCREEN_TYPES.map((id) => ({
	id,
	label: KIOSK_SCREENS[id].size,
	width: KIOSK_SCREENS[id].width,
	height: KIOSK_SCREENS[id].height
}));

const MIN_SCALE = 0.05;

/** Scale that fits `frame` inside `space`: never above 1:1, never zero. */
export function fitScale(
	frame: { width: number; height: number },
	space: { width: number; height: number }
): number {
	const scale = Math.min(space.width / frame.width, space.height / frame.height, 1);
	return Math.max(scale, MIN_SCALE);
}
