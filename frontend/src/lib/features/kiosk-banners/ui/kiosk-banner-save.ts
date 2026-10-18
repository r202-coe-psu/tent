import type { BannerImagePayload } from '../data/kiosk-banner-file';
import type { KioskBannerInput } from '../domain/kiosk-banner';

/** What the banner form hands to its page when the user saves. */
export type KioskBannerSavePayload = {
	input: KioskBannerInput;
	/** Omitted on edit when no new file was chosen (the stored image is kept). */
	image?: BannerImagePayload;
	/** Edit only: the `_rev` the form was opened on, so a concurrent save answers 409. */
	rev?: string;
};
