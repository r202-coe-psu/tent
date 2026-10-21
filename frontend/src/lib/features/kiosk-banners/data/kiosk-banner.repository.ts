import { z } from 'zod';
import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import { kioskBannerDocSchema, type KioskBannerInput } from '../domain/kiosk-banner';
import type { BannerImagePayload } from './kiosk-banner-file';

/** A banner as the back-office API returns it: the doc plus its current `_rev` and image type. */
export const kioskBannerSummarySchema = kioskBannerDocSchema.and(
	z.object({
		_rev: z.string().min(1),
		image_content_type: z.string().nullable()
	})
);

export type KioskBannerSummary = z.infer<typeof kioskBannerSummarySchema>;

export type KioskBannerView = 'current' | 'expired';
export type KioskBannerStatus = KioskBannerSummary['status'];

/** Non-2xx from the banner API: carries the HTTP status and the contract error code. */
export class KioskBannerApiError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'KioskBannerApiError';
		this.status = status;
		this.code = code;
	}
}

export interface KioskBannerRepository {
	list(shelterCode: string, view: KioskBannerView): Promise<KioskBannerSummary[]>;
	get(id: string): Promise<KioskBannerSummary>;
	create(
		shelterCode: string,
		input: KioskBannerInput,
		image: BannerImagePayload
	): Promise<KioskBannerSummary>;
	update(
		id: string,
		rev: string,
		input: KioskBannerInput,
		image?: BannerImagePayload
	): Promise<KioskBannerSummary>;
	setStatus(id: string, rev: string, status: KioskBannerStatus): Promise<KioskBannerSummary>;
	remove(id: string, rev: string): Promise<void>;
	/** Saves a new order; `items` are all current banners of that (group, screen type) slot, in the new order. */
	reorder(
		shelterCode: string,
		slot: { groupId: string; screenType: KioskScreenType },
		items: { id: string; rev: string }[]
	): Promise<KioskBannerSummary[]>;
	/** URL of the stored image; pass `rev` so a replaced image is not served from cache. */
	imageUrl(id: string, rev?: string): string;
}
