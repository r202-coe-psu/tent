import { z } from 'zod';
import {
	DEFAULT_KIOSK_SCREEN_TYPE,
	kioskScreenTypeSchema,
	screenTypeOf,
	type KioskScreenType
} from '$lib/features/shared/domain/kiosk-screen';
import { fromBangkokLocalInput, toBangkokLocalInput } from './kiosk-banner-datetime';
import {
	KIOSK_BANNER_LIMITS,
	kioskBannerInputSchema,
	kioskBannerStatusSchema,
	type KioskBannerInput
} from './kiosk-banner';

/**
 * Back-office banner form (FR-KBR-26). The same field names as {@link KioskBannerInput}, but the
 * times are `datetime-local` strings read as Asia/Bangkok so the errors land under the right
 * field; {@link bannerFormToInput} maps them to the API shape.
 */
const localTime = (missing: string) =>
	z.string().refine((value) => fromBangkokLocalInput(value) !== null, { message: missing });

export const kioskBannerFormSchema = z
	.object({
		title: z
			.string()
			.trim()
			.min(1, 'ระบุหัวข้อแบนเนอร์')
			.max(KIOSK_BANNER_LIMITS.titleMax, 'หัวข้อยาวเกิน 120 ตัวอักษร'),
		caption: z.string().trim().max(KIOSK_BANNER_LIMITS.captionMax, 'คำอธิบายยาวเกิน 200 ตัวอักษร'),
		order: z
			.number({ message: 'ระบุลำดับ' })
			.int('ลำดับต้องเป็นจำนวนเต็ม')
			.min(KIOSK_BANNER_LIMITS.orderMin, 'ลำดับต่ำสุด 1'),
		duration_sec: z
			.number({ message: 'ระบุจำนวนวินาที' })
			.int('วินาทีต้องเป็นจำนวนเต็ม')
			.min(KIOSK_BANNER_LIMITS.durationMin, 'ระยะเวลาต่ำสุด 3 วินาที')
			.max(KIOSK_BANNER_LIMITS.durationMax, 'ระยะเวลาสูงสุด 60 วินาที'),
		start_at: localTime('ระบุเวลาเริ่ม'),
		end_at: localTime('ระบุเวลาสิ้นสุด'),
		status: kioskBannerStatusSchema,
		screen_type: kioskScreenTypeSchema
	})
	.superRefine((value, ctx) => {
		const start = fromBangkokLocalInput(value.start_at);
		const end = fromBangkokLocalInput(value.end_at);
		if (start && end && Date.parse(end) <= Date.parse(start)) {
			ctx.addIssue({
				code: 'custom',
				path: ['end_at'],
				message: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม'
			});
		}
	});

export type KioskBannerFormValues = z.infer<typeof kioskBannerFormSchema>;

export function emptyKioskBannerForm(): KioskBannerFormValues {
	return {
		title: '',
		caption: '',
		order: KIOSK_BANNER_LIMITS.orderDefault,
		duration_sec: KIOSK_BANNER_LIMITS.durationDefault,
		start_at: '',
		end_at: '',
		status: 'active',
		screen_type: DEFAULT_KIOSK_SCREEN_TYPE
	};
}

/** Stored banner fields -> form values (UTC instants shown as Bangkok wall-clock). */
export function bannerToFormValues(
	banner: Omit<KioskBannerInput, 'screen_type'> & { screen_type?: KioskScreenType | null }
): KioskBannerFormValues {
	return {
		title: banner.title,
		caption: banner.caption ?? '',
		order: banner.order,
		duration_sec: banner.duration_sec,
		start_at: toBangkokLocalInput(banner.start_at),
		end_at: toBangkokLocalInput(banner.end_at),
		status: banner.status,
		screen_type: screenTypeOf(banner)
	};
}

/** Validated form values -> the API input (UTC ISO times, blank caption as `null`). */
export function bannerFormToInput(values: KioskBannerFormValues): KioskBannerInput {
	const caption = values.caption.trim();
	return kioskBannerInputSchema.parse({
		title: values.title,
		caption: caption === '' ? null : caption,
		order: values.order,
		duration_sec: values.duration_sec,
		start_at: fromBangkokLocalInput(values.start_at),
		end_at: fromBangkokLocalInput(values.end_at),
		status: values.status,
		screen_type: values.screen_type
	});
}
