import type { LanguageCode } from '$lib/stores/language.svelte';

export interface TicketTranslations {
	backToJobs: string;
	findOtherTicket: string;
	offlineCached: string;
	digitalPassBadge: string;
	tokenLabel: string;
	appliedAtLabel: string;
	defaultJobTitle: string;
	shelterDefault: string;
	appliedAtPrefix: string;
	onSiteVerificationBadge: string;
	onSiteVerificationTitle: string;
	onSiteVerificationSubtitle: string;
	ticketPassCodeLabel: string;
	appointmentTitle: string;
	locationTitle: string;
	applicantInfoTitle: string;
	travelGuidanceTitle: string;
	travelGuidance1: string;
	travelGuidance2: string;
	travelGuidance3: string;
	qrAlt: string;
	qrError: string;
	applicantLabel: string;
	phoneLabel: string;
	dateLabel: string;
	shiftTimeLabel: string;
	meetingPointLabel: string;
	ticketCodeLabel: string;
	downloadQrButton: string;
	copyLinkButton: string;
	cancelTicketButton: string;
	cancelModalTitle: string;
	cancelModalDesc: string;
	cancelModalCancelBtn: string;
	cancelModalConfirmBtn: string;
	cancelling: string;
	toastCopySuccess: string;
	toastCopyError: string;
	toastCancelSuccess: string;
	toastCancelError: string;
	notFoundError: string;
	pageTitle: string;
}

export const ticketI18n: Record<LanguageCode, TicketTranslations> = {
	th: {
		backToJobs: 'กลับไปยังกระดานงาน',
		findOtherTicket: 'ค้นหาตั๋วใบอื่น',
		offlineCached: 'แคชออฟไลน์พร้อมใช้',
		digitalPassBadge: 'บัตรประจำตัวจิตอาสาดิจิทัล (Digital Pass)',
		tokenLabel: 'Token :',
		appliedAtLabel: 'สมัครเมื่อ :',
		defaultJobTitle: 'งานอาสาสมัคร',
		shelterDefault: 'ศูนย์พักพิงหลัก',
		appliedAtPrefix: 'สมัครเมื่อ',
		onSiteVerificationBadge: 'ON-SITE VERIFICATION QR',
		onSiteVerificationTitle: 'สแกนรายงานตัวและเช็คอินหน้างาน',
		onSiteVerificationSubtitle:
			'แสดง QR Code นี้ให้เจ้าหน้าที่จุดลงทะเบียนเมื่อถึงพื้นที่ปฏิบัติงาน',
		ticketPassCodeLabel: 'TICKET PASS CODE',
		appointmentTitle: 'วันและเวลานัดหมาย',
		locationTitle: 'สถานที่ปฏิบัติงาน',
		applicantInfoTitle: 'ข้อมูลผู้สมัครอาสา',
		travelGuidanceTitle: 'คำแนะนำสำหรับการเดินทางมาปฏิบัติงาน',
		travelGuidance1: 'กรุณาเดินทางถึงศูนย์พักพิงก่อนเริ่มกะประมาณ 15 นาที เพื่อรับฟังการชี้แจง',
		travelGuidance2: 'เตรียมบัตรประชาชนตัวจริง และสวมใส่รองเท้าหุ้มส้นเพื่อความปลอดภัย',
		travelGuidance3:
			'หากมีเหตุจำเป็นไม่สามารถมาได้ กรุณากดยกเลิกด้านบนเพื่อให้ผู้อื่นได้โอกาสปฏิบัติหน้าที่',
		qrAlt: 'QR Code สำหรับรายงานตัวหน้างาน',
		qrError: 'แสดง QR Code ไม่สำเร็จ',
		applicantLabel: 'ผู้สมัคร',
		phoneLabel: 'เบอร์โทรศัพท์',
		dateLabel: 'วันที่',
		shiftTimeLabel: 'เวลากะ',
		meetingPointLabel: 'จุดนัดพบ',
		ticketCodeLabel: 'รหัสตั๋ว',
		downloadQrButton: 'บันทึกรูป QR Code ลงเครื่อง',
		copyLinkButton: 'คัดลอกลิงก์ตั๋วนี้',
		cancelTicketButton: 'ขอยกเลิกการสมัครล่วงหน้า (คืนโควตาให้ระบบ)',
		cancelModalTitle: 'ยืนยันการยกเลิกการสมัครจิตอาสา',
		cancelModalDesc:
			'คุณแน่ใจหรือไม่ว่าต้องการยกเลิกการสมัครกะงานนี้? เมื่อยกเลิกแล้วระบบจะคืนโควตาให้ผู้สมัครท่านอื่น และการยกเลิกนี้ไม่สามารถเรียกคืนได้',
		cancelModalCancelBtn: 'กลับไป',
		cancelModalConfirmBtn: 'ยืนยันการยกเลิก',
		cancelling: 'กำลังยกเลิก...',
		toastCopySuccess: 'คัดลอกลิงก์ตั๋วเรียบร้อยแล้ว',
		toastCopyError: 'คัดลอกลิงก์ไม่สำเร็จ',
		toastCancelSuccess: 'ยกเลิกการสมัครเรียบร้อยแล้ว',
		toastCancelError: 'ยกเลิกการสมัครไม่สำเร็จ',
		notFoundError: 'ไม่พบตั๋วนี้',
		pageTitle: 'ตั๋วประจำตัวจิตอาสา — Smart Shelter'
	},
	en: {
		backToJobs: 'Back to Job Board',
		findOtherTicket: 'Find Another Ticket',
		offlineCached: 'Offline Ready',
		digitalPassBadge: 'Volunteer Digital Pass',
		tokenLabel: 'Token:',
		appliedAtLabel: 'Applied on:',
		defaultJobTitle: 'Volunteer Mission',
		shelterDefault: 'Main Evacuation Shelter',
		appliedAtPrefix: 'Applied on',
		onSiteVerificationBadge: 'ON-SITE VERIFICATION QR',
		onSiteVerificationTitle: 'Scan for On-site Check-in',
		onSiteVerificationSubtitle:
			'Present this QR Code to the registration desk when arriving on-site',
		ticketPassCodeLabel: 'TICKET PASS CODE',
		appointmentTitle: 'Appointment Date & Time',
		locationTitle: 'Work Location',
		applicantInfoTitle: 'Volunteer Applicant Details',
		travelGuidanceTitle: 'Instructions for Arriving on Duty',
		travelGuidance1:
			'Please arrive at the shelter approximately 15 minutes before shift start for briefing',
		travelGuidance2: 'Bring physical National ID card and wear closed-toe shoes for safety',
		travelGuidance3:
			'If you are unable to attend, please cancel using the button above to release quota for others',
		qrAlt: 'QR Code for on-site check-in',
		qrError: 'Failed to display QR Code',
		applicantLabel: 'Applicant',
		phoneLabel: 'Phone Number',
		dateLabel: 'Date',
		shiftTimeLabel: 'Shift Time',
		meetingPointLabel: 'Meeting Point',
		ticketCodeLabel: 'Ticket Code',
		downloadQrButton: 'Save QR Code Image',
		copyLinkButton: 'Copy Ticket Link',
		cancelTicketButton: 'Cancel Application (Return Quota)',
		cancelModalTitle: 'Confirm Volunteer Cancellation',
		cancelModalDesc:
			'Are you sure you want to cancel your application for this shift? Once cancelled, your slot will be returned to the pool and this action cannot be undone.',
		cancelModalCancelBtn: 'Keep Application',
		cancelModalConfirmBtn: 'Confirm Cancellation',
		cancelling: 'Cancelling...',
		toastCopySuccess: 'Ticket link copied to clipboard',
		toastCopyError: 'Failed to copy ticket link',
		toastCancelSuccess: 'Application cancelled successfully',
		toastCancelError: 'Failed to cancel application',
		notFoundError: 'Ticket not found',
		pageTitle: 'Volunteer Digital Pass — Smart Shelter'
	}
};

/**
 * Parse timestamps emitted by the backend. Explicit offsets are authoritative;
 * legacy naive datetime values are interpreted as UTC by contract without relying
 * on the browser's local timezone.
 */
function parseBackendTimestamp(value: string): Date {
	const normalized = value.trim().replace(' ', 'T');
	if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized)) return new Date(normalized);

	const naive = normalized.match(
		/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/
	);
	if (naive) {
		const [, year, month, day, hour, minute, second = '0', fraction = ''] = naive;
		const milliseconds = Number(fraction.slice(0, 3).padEnd(3, '0') || '0');
		return new Date(
			Date.UTC(
				Number(year),
				Number(month) - 1,
				Number(day),
				Number(hour),
				Number(minute),
				Number(second),
				milliseconds
			)
		);
	}

	return new Date(normalized);
}

/** Formats ISO timestamp into localized date & time (e.g. "5 ก.ย. 2569, 18:55 น." / "Sep 5, 2026, 6:55 PM") */
export function formatLocalizedDateTime(isoString: string, lang: LanguageCode = 'th'): string {
	if (!isoString) return '';
	const date = parseBackendTimestamp(isoString);
	if (Number.isNaN(date.getTime())) return isoString;

	if (lang === 'th') {
		const formatted = date.toLocaleString('th-TH-u-ca-buddhist', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: 'Asia/Bangkok'
		});
		return `${formatted} น.`;
	}

	return date.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZone: 'Asia/Bangkok'
	});
}

/** Formats ISO / YYYY-MM-DD date into localized date (e.g. "วันเสาร์ที่ 13 มิถุนายน 2569" or "2 กันยายน 2569" / "Saturday, June 13, 2026") */
export function formatLocalizedDate(
	dateStr: string,
	lang: LanguageCode = 'th',
	includeWeekday = false
): string {
	if (!dateStr) return '';
	let normalized = dateStr.trim();
	const ddmmyyyy = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (ddmmyyyy) {
		normalized = `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
	}

	const date = new Date(normalized.includes('T') ? normalized : `${normalized}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return dateStr;

	if (lang === 'th') {
		return date.toLocaleDateString('th-TH-u-ca-buddhist', {
			weekday: includeWeekday ? 'long' : undefined,
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	return date.toLocaleDateString('en-US', {
		weekday: includeWeekday ? 'long' : undefined,
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});
}

/** Formats shift start and end time with localized suffix (e.g. "08:00 - 12:00 น." / "08:00 - 12:00") */
export function formatLocalizedShiftTime(
	startTime?: string | null,
	endTime?: string | null,
	lang: LanguageCode = 'th'
): string {
	if (!startTime && !endTime) return '';
	const st = startTime || '';
	const et = endTime || '';
	if (st && et) {
		return lang === 'th' ? `${st} - ${et} น.` : `${st} - ${et}`;
	}
	const single = st || et;
	return lang === 'th' ? `${single} น.` : single;
}
