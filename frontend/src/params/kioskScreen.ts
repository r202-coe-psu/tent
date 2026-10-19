import { kioskScreenTypeSchema, type KioskScreenType } from '$lib/features/shared';

/** Route param `[screen=kioskScreen]`: only a real screen type, so `new` and banner ids fall through. */
export function match(param: string): param is KioskScreenType {
	return kioskScreenTypeSchema.safeParse(param).success;
}
