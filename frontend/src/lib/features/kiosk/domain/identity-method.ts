export type IdentityMethodId = 'qr' | 'smart-card' | 'thaid';

export interface IdentityMethodDefinition {
	id: IdentityMethodId;
	icon: 'qr' | 'card' | 'thaid';
	title: string;
	description?: string;
	buttonLabel: string;
	enabled: boolean;
	href?: typeof KIOSK_QR_PATH | typeof KIOSK_CARD_PATH | typeof KIOSK_THAID_PATH;
}

export const KIOSK_QR_PATH = '/kiosk/qr';
export const KIOSK_CARD_PATH = '/kiosk/scanner/waiting';
export const KIOSK_THAID_PATH = '/kiosk/thaid';
export const KIOSK_REPRINT_PATH = '/kiosk/reprint';
export const KIOSK_PRINT_QR_PATH = '/kiosk/print-qr';
export const KIOSK_VOLUNTEER_CARD_PATH = '/kiosk/volunteer';

/**
 * Not a check-in method: a secondary entry under the method grid for printing a QR (a registered
 * evacuee who lost theirs, or a volunteer). It opens the chooser. Shown only when the shelter's
 * phone flag is on.
 */
export const KIOSK_REPRINT_ENTRY = {
	title: 'พิมพ์ QR',
	description: 'กรอกเบอร์โทรที่ลงทะเบียนไว้ เพื่อพิมพ์ QR Code',
	href: KIOSK_PRINT_QR_PATH
} as const;

export const IDENTITY_METHODS: readonly IdentityMethodDefinition[] = [
	{
		id: 'qr',
		icon: 'qr',
		title: 'QR ลงทะเบียน',
		description: 'สแกน QR ที่ได้รับจากการลงทะเบียนล่วงหน้า',
		buttonLabel: 'สแกน QR',
		enabled: true,
		href: KIOSK_QR_PATH
	},
	{
		id: 'smart-card',
		icon: 'card',
		title: 'บัตรประชาชน',
		description: 'เสียบบัตรที่ใช้ลงทะเบียน',
		buttonLabel: 'เสียบบัตร',
		enabled: true,
		href: KIOSK_CARD_PATH
	},
	{
		id: 'thaid',
		icon: 'thaid',
		title: 'ThaiD',
		description: 'สแกน QR ด้วยมือถือแล้วยืนยันในแอป ThaiD',
		buttonLabel: 'ใช้ ThaiD',
		enabled: true,
		href: KIOSK_THAID_PATH
	}
] as const;

export interface IdentityMethodOptions {
	/** Per machine, from the scanner client (`KIOSK_QR_CHECK_IN`). */
	qrCheckInEnabled: boolean;
	thaidCheckInEnabled: boolean;
}

/** Methods shown on the kiosk home screen; this is a UI toggle, not an access check. */
export function visibleIdentityMethods(
	options: IdentityMethodOptions
): readonly IdentityMethodDefinition[] {
	return IDENTITY_METHODS.filter(
		(method) =>
			(method.id !== 'qr' || options.qrCheckInEnabled) &&
			(method.id !== 'thaid' || options.thaidCheckInEnabled)
	);
}
