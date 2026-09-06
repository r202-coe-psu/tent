import type { LanguageCode } from '$lib/stores/language.svelte';

export interface TicketTranslations {
	backToJobs: string;
	findOtherTicket: string;
	offlineCached: string;
	digitalPassBadge: string;
	statusConfirmed: string;
	statusPendingReview: string;
	statusCancelled: string;
	tokenLabel: string;
	appliedAtLabel: string;
	defaultJobTitle: string;
	shelterDefault: string;
	appliedAtPrefix: string;
	pendingReviewAlertTitle: string;
	pendingReviewAlertDesc: string;
	confirmedAlertTitle: string;
	confirmedAlertDesc: string;
	cancelledAlertTitle: string;
	cancelledAlertDesc: string;
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
		statusConfirmed: 'ยืนยันแล้ว (Confirmed)',
		statusPendingReview: 'รอการพิจารณา (Pending Review)',
		statusCancelled: 'ยกเลิกแล้ว (Cancelled)',
		tokenLabel: 'Token :',
		appliedAtLabel: 'สมัครเมื่อ :',
		defaultJobTitle: 'งานอาสาสมัคร',
		shelterDefault: 'ศูนย์พักพิงหลัก',
		appliedAtPrefix: 'สมัครเมื่อ',
		pendingReviewAlertTitle: 'อยู่ระหว่างการพิจารณาคุณสมบัติ (Pending Review)',
		pendingReviewAlertDesc:
			'เนื่องจากงานนี้เป็นงานควบคุมหรือเกี่ยวข้องกับความปลอดภัย เจ้าหน้าที่ศูนย์กำลังตรวจสอบคุณสมบัติ กรุณาบันทึกหรือคัดลอกลิงก์ตั๋วนี้เพื่อกลับมาตรวจสอบสถานะก่อนถึงเวลานัด',
		confirmedAlertTitle: 'ยืนยันสิทธิ์เข้าร่วมปฏิบัติงานแล้ว (Confirmed)',
		confirmedAlertDesc:
			'คุณได้รับการยืนยันเข้าร่วมกะปฏิบัติงานแล้ว กรุณาเดินทางมาถึงศูนย์พักพิงตามวันเวลาที่นัดหมาย พร้อมแสดง QR Code นี้เพื่อเช็คอิน',
		cancelledAlertTitle: 'การสมัครถูกยกเลิกแล้ว (Cancelled)',
		cancelledAlertDesc: 'ตั๋วใบนี้ถูกยกเลิกแล้ว หากต้องการสมัครใหม่ กรุณาเลือกกะงานอื่นจากตลาดงาน',
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
		statusConfirmed: 'Confirmed',
		statusPendingReview: 'Pending Review',
		statusCancelled: 'Cancelled',
		tokenLabel: 'Token:',
		appliedAtLabel: 'Applied on:',
		defaultJobTitle: 'Volunteer Mission',
		shelterDefault: 'Main Evacuation Shelter',
		appliedAtPrefix: 'Applied on',
		pendingReviewAlertTitle: 'Under Qualification Review (Pending Review)',
		pendingReviewAlertDesc:
			'Because this role is controlled or related to safety, shelter staff are verifying qualifications. Please save or copy this ticket link to check your status before the shift.',
		confirmedAlertTitle: 'Participation Confirmed (Confirmed)',
		confirmedAlertDesc:
			'Your shift participation has been confirmed. Please arrive at the shelter at the scheduled date and time with this QR Code ready for check-in.',
		cancelledAlertTitle: 'Application Cancelled (Cancelled)',
		cancelledAlertDesc:
			'This ticket has been cancelled. If you wish to volunteer, please apply for an available shift from the job board.',
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

/** Formats ISO timestamp into localized date & time (e.g. "5 ก.ย. 2569, 18:55 น." / "Sep 5, 2026, 6:55 PM") */
export function formatLocalizedDateTime(isoString: string, lang: LanguageCode = 'th'): string {
	if (!isoString) return '';
	let normalized = isoString.trim();
	if (normalized && !normalized.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
		normalized = normalized.includes('T') ? `${normalized}Z` : `${normalized.replace(' ', 'T')}Z`;
	}
	const date = new Date(normalized);
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
