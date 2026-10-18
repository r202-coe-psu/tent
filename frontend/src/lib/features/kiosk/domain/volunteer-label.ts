import {
	KIOSK_LABEL_DIVIDER_MM,
	KIOSK_LABEL_GAP_MM,
	KIOSK_LABEL_PADDING_MM,
	KIOSK_LABEL_TEXT_OFFSET_Y_MM,
	kioskLabelDots,
	mmToDots,
	ptToDots
} from './print-label';

/** Volunteer label text styles (pt + unitless line height), shared by the print CSS and the renderer. */
export const VOLUNTEER_LABEL_TEXT = {
	name: { pt: 16, lineHeight: 1.3, weight: 700, maxLines: 3 },
	badge: { pt: 12, lineHeight: 1.3, weight: 700 },
	link: { pt: 7, lineHeight: 1.3, weight: 500 }
} as const;

export function volunteerLabelIdentity(input: { display_name: string; volunteer_code: string }): {
	name: string;
	badge: string;
} {
	return { name: input.display_name.trim(), badge: `จิตอาสา · ${input.volunteer_code}` };
}

export type VolunteerLabelLayout = {
	qr: { x: number; y: number };
	divider: { x: number; y: number; width: number; height: number };
	text: { x: number; y: number; width: number; bottom: number };
	link: { x: number; y: number };
};

export function volunteerLabelLayout(qrPx: number): VolunteerLabelLayout {
	const { width, height } = kioskLabelDots();
	const padding = Math.round(mmToDots(KIOSK_LABEL_PADDING_MM));
	const gap = Math.round(mmToDots(KIOSK_LABEL_GAP_MM));
	const dividerWidth = Math.max(1, Math.round(mmToDots(KIOSK_LABEL_DIVIDER_MM)));
	const linkLine = ptToDots(VOLUNTEER_LABEL_TEXT.link.pt) * VOLUNTEER_LABEL_TEXT.link.lineHeight;
	const linkBottom = height - padding;
	const qrX = width - padding - qrPx;
	const dividerX = qrX - gap - dividerWidth;
	return {
		qr: { x: qrX, y: Math.round((height - qrPx) / 2) },
		divider: { x: dividerX, y: padding, width: dividerWidth, height: height - padding * 2 },
		text: {
			x: padding,
			y: padding + Math.round(mmToDots(KIOSK_LABEL_TEXT_OFFSET_Y_MM)),
			width: dividerX - gap - padding,
			bottom: Math.floor(linkBottom - linkLine)
		},
		link: { x: padding, y: Math.round(linkBottom - linkLine / 2) }
	};
}
