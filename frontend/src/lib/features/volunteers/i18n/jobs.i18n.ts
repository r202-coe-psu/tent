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
	jobBoardSectionSubtitle: string;
	searchPlaceholder: string;
	filterLabel: string;
	filterAll: string;
	filterOpen: string;
	filterNearFull: string;
	filterControlled: string;
	skillsLabel: string;
	clearFilter: string;
	shelterLabel: string;
	allShelters: string;
	selectShelter: string;
	loadingJobs: string;
	noJobsFound: string;
	noJobsFoundDesc: string;
	clearAllFilters: string;
	generalMission: string;
	controlledMission: string;
	tagOpen: string;
	tagNearFull: string;
	tagFull: string;
	shiftsAndQuota: string;
	shiftsUnit: string;
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
	closeModal: string;
	// Quick Apply Modal
	applyBadgeNoAuth: string;
	applyBadgeNoPassword: string;
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
	applyLineId: string;
	applyEmail: string;
	applyShiftsAvailable: string;
	applyDatePrefix: string;
	applyShiftReceived: string;
	applyShiftNeedMore: string;
	applyQuotaLabel: string;
	applySkillsSelected: string;
	applyLoadingSkills: string;
	applyControlledSkillBadge: string;
	applyMatchesJobBadge: string;
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
	errSkills: string;
}

export const jobsI18n: Record<LanguageCode, JobsTranslations> = {
	th: {
		pageTitle: 'กระดานรับสมัครอาสาสมัคร — Smart Shelter',
		heroTitle: 'ตลาดงานอาสาสมัครในศูนย์พักพิง',
		heroDescription:
			'ร่วมเป็นส่วนหนึ่งในการช่วยเหลือผู้ประสบภัย เลือกภารกิจที่คุณถนัดและเวลาที่สะดวก พร้อมรับตั๋วดิจิทัล (QR Code Pass) ทันทีโดยไม่ต้องรอ SMS OTP',
		heroBadge: 'Volunteer Job Board',
		tabJobBoard: 'ตลาดงานอาสาสมัคร (Job Board)',
		tabFindTicket: 'ค้นหาตั๋วของฉัน (Find My Ticket)',
		portalLink: 'เข้าสู่ระบบจิตอาสา / ตารางงานของฉัน →',
		// Job Board Search & Filters
		jobBoardSectionTitle: 'ตลาดงานอาสาสมัครในศูนย์พักพิง',
		jobBoardSectionSubtitle:
			'เลือกภารกิจและกะเวลาที่คุณสะดวก แล้วกดสมัครเพื่อรับบัตรตั๋วดิจิทัล (QR Code Pass) ทันที (ไม่ต้องใช้รหัสผ่าน)',
		searchPlaceholder: 'ค้นหาชื่องาน, ทักษะ, หรือชื่อศูนย์...',
		filterLabel: 'ตัวกรอง:',
		filterAll: 'ทั้งหมด',
		filterOpen: 'เปิดรับสมัคร (Open)',
		filterNearFull: 'ใกล้เต็ม (Near Full)',
		filterControlled: '🩺 ทักษะวิชาชีพ/ควบคุม',
		skillsLabel: 'ทักษะ:',
		clearFilter: '✕ ล้างตัวกรอง',
		shelterLabel: 'ศูนย์:',
		allShelters: 'ทุกศูนย์พักพิง',
		selectShelter: 'เลือกศูนย์พักพิง',
		loadingJobs: 'กำลังโหลดข้อมูลตลาดงาน...',
		noJobsFound: 'ไม่พบกะงานที่ตรงกับเงื่อนไขการค้นหา',
		noJobsFoundDesc: 'โปรดลองเปลี่ยนตัวกรองหรือคำค้นหาเพื่อดูกะงานอื่น',
		clearAllFilters: 'ล้างตัวกรองทั้งหมด',
		generalMission: 'ภารกิจทั่วไป',
		controlledMission: 'ภารกิจควบคุม',
		tagOpen: 'เปิดรับสมัคร',
		tagNearFull: 'ใกล้เต็ม',
		tagFull: 'เต็มแล้ว',
		shiftsAndQuota: 'รอบกะเวลาและโควตาปฏิบัติงาน',
		shiftsUnit: 'กะ',
		peopleUnit: 'คน',
		seatsUnit: 'ที่',
		skillsUnit: 'ทักษะ',
		totalApplied: 'รวมสมัครแล้ว',
		requiredQuota: 'ต้องการ',
		availableSeats: 'ว่าง',
		fullSeats: 'เต็มแล้ว (0 ที่)',
		applyShift: '🚀 สมัครกะนี้',
		shiftFull: '🔒 กะเต็มแล้ว',
		openBadge: 'เปิดรับ',
		fullBadge: 'เต็มแล้ว',
		quotaCap: 'รับ',
		appliedCount: 'สมัครแล้ว',
		confirmedCount: 'ยืนยันแล้ว',
		defaultJobDesc: 'ช่วยเหลืองานในศูนย์พักพิงตามภารกิจที่ได้รับมอบหมาย',
		// Ticket Search
		ticketSearchTitle: 'ค้นหาตั๋วของฉัน (Find My Ticket Pass)',
		ticketSearchDesc: 'ระบุรหัสบัตร หรือ สแกน QR Code เพื่อเปิดตั๋วดิจิทัล (Digital Pass)',
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
		closeModal: 'ปิดหน้าต่าง',
		// Quick Apply Modal
		applyBadgeNoAuth: 'ระบบสมัครงานจิตอาสาภาคประชาชน (NO-AUTH FLOW)',
		applyBadgeNoPassword: 'ปลอดภัย ไม่ต้องใช้รหัสผ่าน',
		shiftDateLabel: 'กะวันที่',
		applyStep1Title: '1. ข้อมูลประจำตัวอาสาสมัคร',
		applyStep2Title: '2. เลือกรอบกะเวลาปฏิบัติงาน (Shifts)',
		applyStep3Title: '3. ทักษะความสามารถ (ดึงจาก Master Data)',
		applyStep3Subtitle: 'เลือกทักษะที่คุณมีความพร้อมหรือความชำนาญ (สามารถเลือกได้มากกว่า 1 ข้อ)',
		applyFirstName: 'ชื่อ',
		applyLastName: 'นามสกุล',
		applyNickname: 'ชื่อเล่น',
		applyOptional: '(ไม่บังคับ)',
		applyPhone: 'เบอร์โทรศัพท์มือถือ',
		applyPhoneLimitHint: '1 เบอร์ต่อ 1 สิทธิ์การสมัครงานนี้',
		applyLineId: 'Line ID',
		applyEmail: 'อีเมล',
		applyShiftsAvailable: 'กะให้เลือก',
		applyDatePrefix: 'วันที่',
		applyShiftReceived: 'รับแล้ว',
		applyShiftNeedMore: 'ยังขาดอีก',
		applyQuotaLabel: 'โควตา',
		applySkillsSelected: 'เลือกแล้ว',
		applyLoadingSkills: 'กำลังโหลดรายการทักษะมาตรฐาน...',
		applyControlledSkillBadge: 'ทักษะควบคุม',
		applyMatchesJobBadge: 'ตรงกับงานนี้',
		applyPdpaTitle: 'ความยินยอม PDPA:',
		applyPdpaText:
			'ข้าพเจ้ายินยอมให้ศูนย์พักพิงและระบบจัดสรรจิตอาสาเก็บรวบรวมและประมวลผลข้อมูลส่วนบุคคลข้างต้น เพื่อการประสานงานและจัดสรรงานจิตอาสาตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
		applyProtectedFooter: 'Protected by Smart Shelter System & reCAPTCHA',
		applySubmitButton: 'ยืนยันการสมัครและรับตั๋วดิจิทัล',
		applySubmitting: 'กำลังส่งข้อมูล...',
		applyCancelButton: 'ยกเลิก',
		applySuccessTitle: 'สมัครงานจิตอาสาสำเร็จ!',
		applySuccessDesc: 'ระบบได้ออกบัตรตั๋วดิจิทัล (Digital Pass) ประจำตัวของคุณเรียบร้อยแล้ว',
		applyViewPassButton: 'เปิดดูตั๋วดิจิทัลของคุณ',
		toastApplySuccess: 'ส่งใบสมัครสำเร็จ! คุณจะได้รับตั๋วดิจิทัล (QR Code) ทันที',
		errPdpaRequired: 'กรุณายอมรับเงื่อนไข PDPA ก่อนดำเนินการต่อ',
		errNoJobSelected: 'ไม่พบข้อมูลงานหรือกะเวลาที่เลือก',
		errRecaptchaFailed: 'ไม่สามารถยืนยัน reCAPTCHA ได้ กรุณาลองใหม่อีกครั้ง',
		errDuplicatePhoneOrShift:
			'ช่วงเวลากะงานนี้ทับซ้อนหรือเบอร์โทรศัพท์นี้ได้ทำการสมัครงานนี้ไว้แล้ว',
		errRateLimited: 'คุณได้ส่งคำขอบ่อยเกินไป กรุณารอสักครู่',
		errApplyGeneric: 'เกิดข้อผิดพลาดในการส่งใบสมัคร',
		errFirstName: 'กรุณากรอกชื่อจริง',
		errLastName: 'กรุณากรอกนามสกุล',
		errPhone: 'กรุณากรอกเบอร์โทรศัพท์มือถือ 10 หลัก',
		errSkills: 'กรุณาเลือกทักษะอย่างน้อย 1 อย่าง'
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
		jobBoardSectionSubtitle:
			'Choose tasks and shifts that fit your schedule, then apply to receive your instant Digital Pass (QR Code) without passwords.',
		searchPlaceholder: 'Search job title, skills, or shelter...',
		filterLabel: 'Filter:',
		filterAll: 'All',
		filterOpen: 'Openings (Open)',
		filterNearFull: 'Almost Full',
		filterControlled: '🩺 Controlled / Professional',
		skillsLabel: 'Skills:',
		clearFilter: '✕ Clear Filter',
		shelterLabel: 'Shelter:',
		allShelters: 'All Shelters',
		selectShelter: 'Select Shelter',
		loadingJobs: 'Loading volunteer jobs...',
		noJobsFound: 'No volunteer shifts match your search criteria',
		noJobsFoundDesc: 'Try adjusting your search filters or select a different shelter',
		clearAllFilters: 'Clear all filters',
		generalMission: 'General Mission',
		controlledMission: 'Controlled Mission',
		tagOpen: 'Open',
		tagNearFull: 'Almost Full',
		tagFull: 'Full',
		shiftsAndQuota: 'Shifts & Capacity Quota',
		shiftsUnit: 'shifts',
		peopleUnit: 'people',
		seatsUnit: 'seats',
		skillsUnit: 'skills',
		totalApplied: 'Total Applicants',
		requiredQuota: 'Required',
		availableSeats: 'Available',
		fullSeats: 'Full (0 seats)',
		applyShift: '🚀 Apply Shift',
		shiftFull: '🔒 Shift Full',
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
		closeModal: 'Close',
		// Quick Apply Modal
		applyBadgeNoAuth: 'Public Volunteer Registration (NO-AUTH FLOW)',
		applyBadgeNoPassword: 'Secure & Passwordless',
		shiftDateLabel: 'Shift Date',
		applyStep1Title: '1. Volunteer Identity Information',
		applyStep2Title: '2. Select Shift Time (Shifts)',
		applyStep3Title: '3. Skills & Capabilities (Master Data)',
		applyStep3Subtitle: 'Select skills matching your capabilities (Multiple selection allowed)',
		applyFirstName: 'First Name',
		applyLastName: 'Last Name',
		applyNickname: 'Nickname',
		applyOptional: '(Optional)',
		applyPhone: 'Mobile Phone Number',
		applyPhoneLimitHint: '1 application per phone number for this job',
		applyLineId: 'Line ID',
		applyEmail: 'Email',
		applyShiftsAvailable: 'shifts available',
		applyDatePrefix: 'Date',
		applyShiftReceived: 'Registered',
		applyShiftNeedMore: 'Remaining needed',
		applyQuotaLabel: 'Quota',
		applySkillsSelected: 'Selected',
		applyLoadingSkills: 'Loading standard skills master data...',
		applyControlledSkillBadge: 'Controlled Skill',
		applyMatchesJobBadge: 'Matches Job',
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
		toastApplySuccess:
			'Application submitted! You will receive your Digital Pass (QR Code) instantly.',
		errPdpaRequired: 'Please accept the PDPA consent before proceeding',
		errNoJobSelected: 'No job or shift selected',
		errRecaptchaFailed: 'reCAPTCHA verification failed. Please try again.',
		errDuplicatePhoneOrShift:
			'This shift time overlaps or this phone number has already applied for this job',
		errRateLimited: 'Too many requests. Please wait a moment.',
		errApplyGeneric: 'An error occurred while submitting your application',
		errFirstName: 'Please enter your first name',
		errLastName: 'Please enter your last name',
		errPhone: 'Please enter a valid 10-digit mobile phone number',
		errSkills: 'Please select at least 1 skill'
	}
};
