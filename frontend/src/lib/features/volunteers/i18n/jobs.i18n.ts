import type { LanguageCode } from '$lib/stores/language.svelte';

export interface JobsTranslations {
	pageTitle: string;
	heroTitle: string;
	heroDescription: string;
	heroBadge: string;
	tabJobBoard: string;
	tabFindTicket: string;
	portalLink: string;
	// Job Board Search & Filters
	jobBoardSectionTitle: string;
	searchPlaceholder: string;
	filterLabel: string;
	filterAll: string;
	filterOpen: string;
	filterNearFull: string;
	filterControlled: string;
	skillsLabel: string;
	/** Heading above a job card's required skills. */
	cardSkillsTitle: string;
	/** Appended to a shift's `HH:MM - HH:MM` range (Thai " น.", nothing in English). */
	timeSuffix: string;
	clearFilter: string;
	shelterLabel: string;
	allShelters: string;
	selectShelter: string;
	loadingJobs: string;
	noJobsFound: string;
	noJobsFoundDesc: string;
	paginationSummary: (from: number, to: number, total: number) => string;
	clearAllFilters: string;
	generalMission: string;
	controlledMission: string;
	tagOpen: string;
	tagNearFull: string;
	tagFull: string;
	tagClosed: string;
	shiftsAndQuota: string;
	shiftsUnit: string;
	moreShiftsPrefix: string;
	moreShiftsIn: string;
	daysUnit: string;
	moreShiftsDates: string;
	moreShiftsTimes: string;
	showAllShifts: string;
	collapseShifts: string;
	peopleUnit: string;
	seatsUnit: string;
	skillsUnit: string;
	totalApplied: string;
	requiredQuota: string;
	availableSeats: string;
	fullSeats: string;
	applyShift: string;
	shiftFull: string;
	openBadge: string;
	fullBadge: string;
	quotaCap: string;
	appliedCount: string;
	confirmedCount: string;
	defaultJobDesc: string;
	// Ticket Search
	ticketSearchTitle: string;
	ticketSearchDesc: string;
	ticketSearchPlaceholder: string;
	ticketSearchButton: string;
	ticketSearching: string;
	ticketScanQr: string;
	ticketScanTitle: string;
	ticketScanTooltip: string;
	ticketEmptySearchTitle: string;
	ticketEmptySearchDesc: string;
	ticketNotFoundTitle: string;
	ticketNotFoundDesc: string;
	ticketFoundCount: string;
	ticketPhoneLabel: string;
	ticketOpenDigitalPass: string;
	ticketErrorEmpty: string;
	cameraPermissionError: string;
	cameraScanHint: string;
	qrUploadButton: string;
	applyPickShift: string;
	applySeatsLeftPrefix: string;
	applySeatsLeftSuffix: string;
	applyMoreDatesPrefix: string;
	applyMoreDatesSuffix: string;
	qrUploadReading: string;
	qrUploadHint: string;
	qrUploadNotFound: string;
	qrUploadNotImage: string;
	qrUploadTooLarge: string;
	closeModal: string;
	// Quick Apply Modal
	shiftDateLabel: string;
	applyStep1Title: string;
	applyStep2Title: string;
	applyStep3Title: string;
	applyStep3Subtitle: string;
	applyFirstName: string;
	applyLastName: string;
	applyNickname: string;
	applyOptional: string;
	applyPhone: string;
	applyPhoneLimitHint: string;
	applyEmail: string;
	applyShiftsAvailable: string;
	/** Multi-shift picker (#716). */
	applyPickShiftsHint: string;
	applyShiftConflict: string;
	applyShiftsPicked: string;
	errNoShiftPicked: string;
	applyOutcomePartialTitle: string;
	applyOutcomeNoneTitle: string;
	applyOutcomeNoneBody: string;
	applyOutcomeSaved: string;
	applyOutcomeFailed: string;
	applyOutcomeContinue: string;
	applyOutcomePickAgain: string;
	applyDatePrefix: string;
	applyShiftReceived: string;
	applyShiftNeedMore: string;
	applyQuotaLabel: string;
	applySkillsSelected: string;
	applyLoadingSkills: string;
	applyControlledSkillBadge: string;
	applyMatchesJobBadge: string;
	applySkillsSuggestion: string;
	applyPdpaTitle: string;
	applyPdpaText: string;
	applyProtectedFooter: string;
	applySubmitButton: string;
	applySubmitting: string;
	applyCancelButton: string;
	applySuccessTitle: string;
	applySuccessDesc: string;
	applyViewPassButton: string;
	toastApplySuccess: string;
	errPdpaRequired: string;
	errNoJobSelected: string;
	errRecaptchaFailed: string;
	errDuplicatePhoneOrShift: string;
	errRateLimited: string;
	errApplyGeneric: string;
	errFirstName: string;
	errLastName: string;
	errPhone: string;
}

export const jobsI18n: Record<LanguageCode, JobsTranslations> = {
	th: {
		pageTitle: 'กระดานรับสมัครอาสาสมัคร — Smart Shelter',
		heroTitle: 'งานอาสาสมัครในศูนย์พักพิง',
		heroDescription:
			'ร่วมเป็นส่วนหนึ่งในการช่วยเหลือผู้ประสบภัย เลือกงานอาสาสมัครที่คุณถนัดและเวลาที่สะดวก พร้อมรับตั๋วดิจิทัล',
		heroBadge: 'Volunteer Job Board',
		tabJobBoard: 'งานอาสาสมัคร',
		tabFindTicket: 'ค้นหาตั๋วของฉัน',
		portalLink: 'เข้าสู่ระบบอาสาสมัคร / ตารางงานของฉัน →',
		// Job Board Search & Filters
		jobBoardSectionTitle: 'งานอาสาสมัครในศูนย์พักพิง',
		searchPlaceholder: 'ค้นหาชื่องาน, ทักษะ, หรือชื่อศูนย์...',
		filterLabel: 'ตัวกรอง:',
		filterAll: 'ทั้งหมด',
		filterOpen: 'เปิดรับสมัคร',
		filterNearFull: 'ใกล้เต็ม',
		filterControlled: 'ทักษะวิชาชีพ/ควบคุม',
		skillsLabel: 'ทักษะ:',
		cardSkillsTitle: 'ความสามารถ',
		timeSuffix: ' น.',
		clearFilter: '✕ ล้างตัวกรอง',
		shelterLabel: 'ศูนย์:',
		allShelters: 'ทุกศูนย์พักพิง',
		selectShelter: 'เลือกศูนย์พักพิง',
		loadingJobs: 'กำลังโหลดข้อมูลงาน...',
		noJobsFound: 'ไม่พบกะงานที่ตรงกับเงื่อนไขการค้นหา',
		noJobsFoundDesc: 'โปรดลองเปลี่ยนตัวกรองหรือคำค้นหาเพื่อดูกะงานอื่น',
		paginationSummary: (from, to, total) => `แสดงงานที่ ${from} - ${to} จากทั้งหมด ${total} งาน`,
		clearAllFilters: 'ล้างตัวกรองทั้งหมด',
		generalMission: 'งานอาสาสมัครทั่วไป',
		controlledMission: 'งานอาสาสมัครทักษะควบคุม',
		tagOpen: 'เปิดรับสมัคร',
		tagNearFull: 'ใกล้เต็ม',
		tagFull: 'เต็มแล้ว',
		tagClosed: 'ปิดรับแล้ว',
		shiftsAndQuota: 'รอบกะเวลาและโควตาปฏิบัติงาน',
		shiftsUnit: 'กะ',
		moreShiftsPrefix: 'ยังมีอีก',
		moreShiftsIn: 'ใน',
		daysUnit: 'วัน',
		moreShiftsDates: 'วันที่',
		moreShiftsTimes: 'ช่วงเวลา',
		showAllShifts: 'ดูกะทั้งหมด',
		collapseShifts: 'ย่อรายการกะ',
		peopleUnit: 'คน',
		seatsUnit: 'ที่',
		skillsUnit: 'ทักษะ',
		totalApplied: 'รวมสมัครแล้ว',
		requiredQuota: 'ต้องการ',
		availableSeats: 'ว่าง',
		fullSeats: 'เต็มแล้ว (0 ที่)',
		applyShift: 'สมัครกะนี้',
		shiftFull: 'กะเต็มแล้ว',
		openBadge: 'เปิดรับ',
		fullBadge: 'เต็มแล้ว',
		quotaCap: 'รับ',
		appliedCount: 'สมัครแล้ว',
		confirmedCount: 'ยืนยันแล้ว',
		defaultJobDesc: 'ช่วยเหลืองานในศูนย์พักพิงตามงานอาสาสมัครที่ได้รับมอบหมาย',
		// Ticket Search
		ticketSearchTitle: 'ค้นหาตั๋วของฉัน',
		ticketSearchDesc: 'ระบุรหัสบัตร หรือ สแกน QR Code เพื่อเปิดตั๋วดิจิทัล',
		ticketSearchPlaceholder: 'กรอกรหัสบัตร เช่น TKT-VOL-123456 หรือ Token ตั๋ว',
		ticketSearchButton: 'ค้นหาตั๋ว',
		ticketSearching: 'กำลังค้นหา...',
		ticketScanQr: 'สแกน QR',
		ticketScanTitle: 'สแกน QR Code ค้นหาตั๋วอาสาสมัคร',
		ticketScanTooltip: 'เปิดกล้องสแกน QR Code ตั๋ว',
		ticketEmptySearchTitle: 'ยังไม่มีการค้นหา',
		ticketEmptySearchDesc:
			'ตั๋วดิจิทัลจะแสดงข้อมูลกะงาน สถานะการยืนยัน และ QR Code สำหรับสแกนเข้าพื้นที่',
		ticketNotFoundTitle: 'ไม่พบตั๋วสำหรับการค้นหานี้',
		ticketNotFoundDesc:
			'ไม่พบประวัติการสมัครงานที่ตรงกับข้อมูลที่ระบุ กรุณาตรวจสอบรหัสบัตรอีกครั้ง',
		ticketFoundCount: 'พบตั๋วจิตอาสาทั้งหมด',
		ticketPhoneLabel: 'เบอร์โทร:',
		ticketOpenDigitalPass: 'เปิดตั๋วดิจิทัล',
		ticketErrorEmpty: 'กรุณากรอกรหัสบัตร หรือ รหัส Token ตั๋วจิตอาสา',
		cameraPermissionError: 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง',
		cameraScanHint: 'หันกล้องไปยัง QR Code บนตั๋วดิจิทัลหรือบัตรงานจิตอาสา',
		qrUploadButton: 'เลือกรูป QR จากเครื่อง',
		applyPickShift: 'เลือกวันและช่วงเวลา',
		applySeatsLeftPrefix: 'เหลือ',
		applySeatsLeftSuffix: 'ที่',
		applyMoreDatesPrefix: 'แสดงวันที่เหลืออีก',
		applyMoreDatesSuffix: 'วัน',
		qrUploadReading: 'กำลังอ่าน QR จากรูป…',
		qrUploadHint: 'อ่าน QR จากรูปบนเครื่องนี้เท่านั้น — รูปไม่ถูกส่งขึ้นระบบ',
		qrUploadNotFound: 'อ่าน QR จากรูปนี้ไม่ได้ — ลองรูปที่ชัดขึ้น หรือครอบให้เห็นเฉพาะ QR',
		qrUploadNotImage: 'ไฟล์นี้ไม่ใช่รูปภาพ — กรุณาเลือกรูป QR (JPG หรือ PNG)',
		qrUploadTooLarge: 'รูปใหญ่เกิน 10 MB — กรุณาเลือกรูปที่เล็กกว่านี้',
		closeModal: 'ปิดหน้าต่าง',
		// Quick Apply Modal
		shiftDateLabel: 'กะวันที่',
		applyStep1Title: '1. ข้อมูลประจำตัวอาสาสมัคร',
		applyStep2Title: '2. เลือกรอบกะเวลาปฏิบัติงาน',
		applyStep3Title: '3. ทักษะความสามารถ',
		applyStep3Subtitle: 'เลือกทักษะที่คุณมีความพร้อมหรือความชำนาญ (เลือกได้ ไม่บังคับ)',
		applyFirstName: 'ชื่อ',
		applyLastName: 'นามสกุล',
		applyNickname: 'ชื่อเล่น',
		applyOptional: '(ไม่บังคับ)',
		applyPhone: 'เบอร์โทรศัพท์มือถือ',
		applyPhoneLimitHint: '1 เบอร์ต่อ 1 สิทธิ์การสมัครงานนี้',
		applyEmail: 'อีเมล',
		applyShiftsAvailable: 'กะให้เลือก',
		applyPickShiftsHint: 'เลือกได้หลายกะ กดกะที่เลือกแล้วอีกครั้งเพื่อเอาออก',
		applyShiftConflict: 'เวลาชน',
		applyShiftsPicked: 'กะที่เลือก',
		errNoShiftPicked: 'กรุณาเลือกอย่างน้อย 1 กะ',
		applyOutcomePartialTitle: 'บางกะสมัครไม่สำเร็จ',
		applyOutcomeNoneTitle: 'สมัครไม่สำเร็จ',
		applyOutcomeNoneBody: 'ยังไม่มีกะไหนถูกบันทึก เลือกกะอื่นแล้วสมัครอีกครั้งได้',
		applyOutcomeSaved: 'บันทึกแล้ว',
		applyOutcomeFailed: 'ไม่ผ่าน',
		applyOutcomeContinue: 'ไปต่อ',
		applyOutcomePickAgain: 'เลือกกะใหม่',
		applyDatePrefix: 'วันที่',
		applyShiftReceived: 'รับแล้ว',
		applyShiftNeedMore: 'ยังขาดอีก',
		applyQuotaLabel: 'โควตา',
		applySkillsSelected: 'เลือกแล้ว',
		applyLoadingSkills: 'กำลังโหลดรายการทักษะมาตรฐาน...',
		applyControlledSkillBadge: 'ทักษะควบคุม',
		applyMatchesJobBadge: 'แนะนำ',
		applySkillsSuggestion: 'ทักษะที่มีไอคอนประกายเป็นทักษะแนะนำสำหรับงานอาสาสมัครนี้',
		applyPdpaTitle: 'ความยินยอม PDPA:',
		applyPdpaText:
			'ข้าพเจ้ายินยอมให้ศูนย์พักพิงและระบบจัดสรรจิตอาสาเก็บรวบรวมและประมวลผลข้อมูลส่วนบุคคลข้างต้น เพื่อการประสานงานและจัดสรรงานจิตอาสาตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
		applyProtectedFooter: 'Protected by Smart Shelter System & reCAPTCHA',
		applySubmitButton: 'ยืนยันการสมัครและรับตั๋วดิจิทัล',
		applySubmitting: 'กำลังส่งข้อมูล...',
		applyCancelButton: 'ยกเลิก',
		applySuccessTitle: 'สมัครงานจิตอาสาสำเร็จ!',
		applySuccessDesc: 'ระบบได้ออกบัตรตั๋วดิจิทัลประจำตัวของคุณเรียบร้อยแล้ว',
		applyViewPassButton: 'เปิดดูตั๋วดิจิทัลของคุณ',
		toastApplySuccess: 'ส่งใบสมัครสำเร็จ!',
		errPdpaRequired: 'กรุณายอมรับเงื่อนไข PDPA ก่อนดำเนินการต่อ',
		errNoJobSelected: 'ไม่พบข้อมูลงานหรือกะเวลาที่เลือก',
		errRecaptchaFailed: 'ไม่สามารถยืนยัน reCAPTCHA ได้ กรุณาลองใหม่อีกครั้ง',
		errDuplicatePhoneOrShift:
			'ช่วงเวลากะงานนี้ทับซ้อนหรือเบอร์โทรศัพท์นี้ได้ทำการสมัครงานนี้ไว้แล้ว',
		errRateLimited: 'คุณได้ส่งคำขอบ่อยเกินไป กรุณารอสักครู่',
		errApplyGeneric: 'เกิดข้อผิดพลาดในการส่งใบสมัคร',
		errFirstName: 'กรุณากรอกชื่อจริง',
		errLastName: 'กรุณากรอกนามสกุล',
		errPhone: 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0'
	},
	en: {
		pageTitle: 'Volunteer Job Board — Smart Shelter',
		heroTitle: 'Volunteer Job Board in Evacuation Shelters',
		heroDescription:
			'Be part of helping disaster evacuees. Choose tasks matching your skills and schedule, and receive your Digital Pass (QR Code) instantly without SMS OTP.',
		heroBadge: 'Volunteer Job Board',
		tabJobBoard: 'Volunteer Job Board',
		tabFindTicket: 'Find My Ticket',
		portalLink: 'Volunteer Portal / My Schedule →',
		// Job Board Search & Filters
		jobBoardSectionTitle: 'Volunteer Job Board in Evacuation Shelters',
		searchPlaceholder: 'Search job title, skills, or shelter...',
		filterLabel: 'Filter:',
		filterAll: 'All',
		filterOpen: 'Openings (Open)',
		filterNearFull: 'Almost Full',
		filterControlled: 'Controlled / Professional',
		skillsLabel: 'Skills:',
		cardSkillsTitle: 'Skills',
		timeSuffix: '',
		clearFilter: '✕ Clear Filter',
		shelterLabel: 'Shelter:',
		allShelters: 'All Shelters',
		selectShelter: 'Select Shelter',
		loadingJobs: 'Loading volunteer jobs...',
		noJobsFound: 'No volunteer shifts match your search criteria',
		noJobsFoundDesc: 'Try adjusting your search filters or select a different shelter',
		paginationSummary: (from, to, total) => `Showing jobs ${from} - ${to} of ${total}`,
		clearAllFilters: 'Clear all filters',
		generalMission: 'General Mission',
		controlledMission: 'Controlled Mission',
		tagOpen: 'Open',
		tagNearFull: 'Almost Full',
		tagFull: 'Full',
		tagClosed: 'Closed',
		shiftsAndQuota: 'Shifts & Capacity Quota',
		shiftsUnit: 'shifts',
		moreShiftsPrefix: 'Plus',
		moreShiftsIn: 'on',
		daysUnit: 'days',
		moreShiftsDates: 'Dates',
		moreShiftsTimes: 'Times',
		showAllShifts: 'Show all shifts',
		collapseShifts: 'Show fewer shifts',
		peopleUnit: 'people',
		seatsUnit: 'seats',
		skillsUnit: 'skills',
		totalApplied: 'Total Applicants',
		requiredQuota: 'Required',
		availableSeats: 'Available',
		fullSeats: 'Full (0 seats)',
		applyShift: 'Apply Shift',
		shiftFull: 'Shift Full',
		openBadge: 'Open',
		fullBadge: 'Full',
		quotaCap: 'Quota',
		appliedCount: 'Applied',
		confirmedCount: 'Confirmed',
		defaultJobDesc: 'Assisting shelter operations according to assigned tasks',
		// Ticket Search
		ticketSearchTitle: 'Find My Ticket Pass',
		ticketSearchDesc: 'Enter your ticket card ID or scan QR code to open your Digital Pass',
		ticketSearchPlaceholder: 'Enter ticket code e.g. TKT-VOL-123456 or Token',
		ticketSearchButton: 'Find Ticket',
		ticketSearching: 'Searching...',
		ticketScanQr: 'Scan QR',
		ticketScanTitle: 'Scan Volunteer QR Code',
		ticketScanTooltip: 'Open camera to scan volunteer ticket QR code',
		ticketEmptySearchTitle: 'No Search Yet',
		ticketEmptySearchDesc:
			'Your Digital Pass displays shift schedule, verification status, and QR Code for on-site access',
		ticketNotFoundTitle: 'No Ticket Found',
		ticketNotFoundDesc:
			'No application matching the provided token was found. Please check your ticket code.',
		ticketFoundCount: 'Total volunteer tickets found',
		ticketPhoneLabel: 'Phone:',
		ticketOpenDigitalPass: 'Open Digital Pass',
		ticketErrorEmpty: 'Please enter your ticket card code or volunteer token',
		cameraPermissionError: 'Unable to access camera. Please check camera permissions.',
		cameraScanHint: 'Point camera at the QR code on your Digital Pass or volunteer badge',
		qrUploadButton: 'Choose a QR image',
		applyPickShift: 'Pick a date and time',
		applySeatsLeftPrefix: '',
		applySeatsLeftSuffix: 'left',
		applyMoreDatesPrefix: 'Show',
		applyMoreDatesSuffix: 'more dates',
		qrUploadReading: 'Reading the QR from the image…',
		qrUploadHint: 'Read on this device only — the image is never uploaded',
		qrUploadNotFound: 'No QR found in this image — try a sharper photo or crop to the QR',
		qrUploadNotImage: 'This file is not an image — please choose a QR image (JPG or PNG)',
		qrUploadTooLarge: 'The image is over 10 MB — please choose a smaller one',
		closeModal: 'Close',
		// Quick Apply Modal
		shiftDateLabel: 'Shift Date',
		applyStep1Title: '1. Volunteer Identity Information',
		applyStep2Title: '2. Select Shift Time (Shifts)',
		applyStep3Title: '3. Skills & Capabilities',
		applyStep3Subtitle: 'Select skills matching your capabilities (Optional)',
		applyFirstName: 'First Name',
		applyLastName: 'Last Name',
		applyNickname: 'Nickname',
		applyOptional: '(Optional)',
		applyPhone: 'Mobile Phone Number',
		applyPhoneLimitHint: '1 application per phone number for this job',
		applyEmail: 'Email',
		applyShiftsAvailable: 'shifts available',
		applyPickShiftsHint: 'You can pick several shifts. Tap a picked shift again to remove it.',
		applyShiftConflict: 'Clashes',
		applyShiftsPicked: 'shifts picked',
		errNoShiftPicked: 'Pick at least one shift',
		applyOutcomePartialTitle: 'Some shifts were not saved',
		applyOutcomeNoneTitle: 'Application not saved',
		applyOutcomeNoneBody: 'No shift was saved. Pick other shifts and apply again.',
		applyOutcomeSaved: 'Saved',
		applyOutcomeFailed: 'Not saved',
		applyOutcomeContinue: 'Continue',
		applyOutcomePickAgain: 'Pick other shifts',
		applyDatePrefix: 'Date',
		applyShiftReceived: 'Registered',
		applyShiftNeedMore: 'Remaining needed',
		applyQuotaLabel: 'Quota',
		applySkillsSelected: 'Selected',
		applyLoadingSkills: 'Loading standard skills master data...',
		applyControlledSkillBadge: 'Controlled Skill',
		applyMatchesJobBadge: 'Suggested',
		applySkillsSuggestion:
			'Skills marked with a sparkle are suggestions for this job. Choose what matches your capabilities; selection is optional.',
		applyPdpaTitle: 'PDPA Consent:',
		applyPdpaText:
			'I consent to the evacuation shelter and volunteer coordination system collecting and processing my personal data for volunteer management in accordance with the Personal Data Protection Act (PDPA).',
		applyProtectedFooter: 'Protected by Smart Shelter System & reCAPTCHA',
		applySubmitButton: 'Confirm Application & Get Digital Pass',
		applySubmitting: 'Submitting application...',
		applyCancelButton: 'Cancel',
		applySuccessTitle: 'Application Submitted Successfully!',
		applySuccessDesc: 'Your Digital Pass has been generated and is ready for on-site check-in.',
		applyViewPassButton: 'Open Your Digital Pass',
		toastApplySuccess: 'Application submitted!',
		errPdpaRequired: 'Please accept the PDPA consent before proceeding',
		errNoJobSelected: 'No job or shift selected',
		errRecaptchaFailed: 'reCAPTCHA verification failed. Please try again.',
		errDuplicatePhoneOrShift:
			'This shift time overlaps or this phone number has already applied for this job',
		errRateLimited: 'Too many requests. Please wait a moment.',
		errApplyGeneric: 'An error occurred while submitting your application',
		errFirstName: 'Please enter your first name',
		errLastName: 'Please enter your last name',
		errPhone: 'Phone must be a 10-digit number starting with 0'
	}
};
