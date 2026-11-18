import { z } from 'zod';
import {
	DEFAULT_KIOSK_SCREEN_TYPE,
	kioskScreenTypeSchema,
	screenTypeOf,
	type KioskScreenType
} from '$lib/features/shared/domain/kiosk-screen';
import {
	fromBangkokLocalInput,
	splitLocalInput,
	toBangkokLocalInput
} from './kiosk-banner-datetime';
import {
	KIOSK_BANNER_LIMITS,
	groupOf,
	kioskBannerInputSchema,
	kioskBannerStatusSchema,
	type KioskBannerInput
} from './kiosk-banner';
import {
	TEMPLATE_IMAGE_ATTACHMENT,
	emptyKioskBannerTemplate,
	kioskBannerTemplateAlignSchema,
	kioskBannerTemplateSchema,
	type KioskBannerTemplate
} from './kiosk-banner-template';

/**
 * Back-office banner form (FR-KBR-26). The same field names as {@link KioskBannerInput}, but the
 * times are `datetime-local` strings read as Asia/Bangkok so the errors land under the right
 * field; {@link bannerFormToInput} maps them to the API shape.
 */
const localTime = (label: string) =>
	z.string().superRefine((value, ctx) => {
		if (fromBangkokLocalInput(value) !== null) return;
		const { date, time } = splitLocalInput(value);
		// Name the missing half, so the form can mark the date picker, the time picker or both.
		const message =
			!date && !time
				? `ระบุวันและเวลา${label}`
				: !time
					? `เลือกเวลา${label}`
					: !date
						? `เลือกวันที่${label}`
						: `ระบุเวลา${label}`;
		ctx.addIssue({ code: 'custom', message });
	});

/** Where the banner image comes from: an uploaded file or one rendered from the template. */
export const kioskBannerSourceSchema = z.enum(['upload', 'template']);
export type KioskBannerSource = z.infer<typeof kioskBannerSourceSchema>;

/**
 * The template as the form edits it: plain strings (colours may be half-typed). It is checked
 * against {@link kioskBannerTemplateSchema} only while the source is `template`, which also keeps
 * the transforms out of the Superforms JSON-schema conversion.
 */
const templateFormSchema = z.object({
	heading: z.string(),
	body: z.string(),
	align: kioskBannerTemplateAlignSchema,
	bg_color: z.string(),
	text_color: z.string(),
	image: z.literal(TEMPLATE_IMAGE_ATTACHMENT).nullable()
});

export const kioskBannerFormSchema = z
	.object({
		group_id: z.string().min(1, 'เลือกกลุ่มแบนเนอร์'),
		title: z
			.string()
			.trim()
			.min(1, 'ระบุหัวข้อแบนเนอร์')
			.max(KIOSK_BANNER_LIMITS.titleMax, 'หัวข้อยาวเกิน 120 ตัวอักษร'),
		caption: z.string().trim().max(KIOSK_BANNER_LIMITS.captionMax, 'คำอธิบายยาวเกิน 200 ตัวอักษร'),
		duration_sec: z
			.number({ message: 'ระบุจำนวนวินาที' })
			.int('วินาทีต้องเป็นจำนวนเต็ม')
			.min(KIOSK_BANNER_LIMITS.durationMin, 'ระยะเวลาต่ำสุด 3 วินาที')
			.max(KIOSK_BANNER_LIMITS.durationMax, 'ระยะเวลาสูงสุด 60 วินาที'),
		start_at: localTime('เริ่ม'),
		end_at: localTime('สิ้นสุด'),
		status: kioskBannerStatusSchema,
		screen_type: kioskScreenTypeSchema,
		source: kioskBannerSourceSchema,
		template: templateFormSchema
	})
	.superRefine((value, ctx) => {
		if (value.source === 'template') {
			const parsed = kioskBannerTemplateSchema.safeParse(value.template);
			if (!parsed.success) {
				for (const issue of parsed.error.issues) {
					ctx.addIssue({
						code: 'custom',
						path: ['template', ...issue.path],
						message: issue.message
					});
				}
			}
		}
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
		group_id: '',
		title: '',
		caption: '',
		duration_sec: KIOSK_BANNER_LIMITS.durationDefault,
		start_at: '',
		end_at: '',
		status: 'active',
		screen_type: DEFAULT_KIOSK_SCREEN_TYPE,
		source: 'upload',
		template: emptyKioskBannerTemplate()
	};
}

/** Stored banner fields -> form values (UTC instants shown as Bangkok wall-clock). */
export function bannerToFormValues(
	banner: Omit<KioskBannerInput, 'screen_type' | 'group_id'> & {
		screen_type?: KioskScreenType | null;
		group_id?: string | null;
		template?: KioskBannerTemplate;
	}
): KioskBannerFormValues {
	return {
		group_id: groupOf(banner) ?? '',
		title: banner.title,
		caption: banner.caption ?? '',
		duration_sec: banner.duration_sec,
		start_at: toBangkokLocalInput(banner.start_at),
		end_at: toBangkokLocalInput(banner.end_at),
		status: banner.status,
		screen_type: screenTypeOf(banner),
		source: banner.template ? 'template' : 'upload',
		template: banner.template ?? emptyKioskBannerTemplate()
	};
}

/** Validated form values -> the API input (UTC ISO times, blank caption as `null`). */
export function bannerFormToInput(values: KioskBannerFormValues): KioskBannerInput {
	const caption = values.caption.trim();
	return kioskBannerInputSchema.parse({
		group_id: values.group_id,
		title: values.title,
		caption: caption === '' ? null : caption,
		duration_sec: values.duration_sec,
		start_at: fromBangkokLocalInput(values.start_at),
		end_at: fromBangkokLocalInput(values.end_at),
		status: values.status,
		screen_type: values.screen_type,
		...(values.source === 'template' ? { template: values.template } : {})
	});
}
