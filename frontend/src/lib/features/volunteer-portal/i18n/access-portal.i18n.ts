import type { LanguageCode } from '$lib/stores/language.svelte';

/**
 * Copy for the volunteer Access Portal (`/volunteers/portal`): the sign-in screen, the role
 * card, "ตารางของฉัน" with its filters and offers, the leave dialog, and the profile editor's
 * page titles. Dates stay in the Thai (พ.ศ.) helpers by team decision; user-entered data
 * (names, job titles, stations) is shown as stored.
 */
export interface AccessPortalTranslations {
	pageTitleEntry: string;
	pageTitleDashboard: string;
	pageTitleOpenings: string;

	// Header + sign-in
	headingSchedule: string;
	headingSignIn: string;
	signInIntro: string;
	restoringTitle: string;
	restoringBody: string;
	tabPhone: string;
	tabQr: string;
	phoneLabel: string;
	phonePlaceholder: string;
	phoneHint: string;
	submitChecking: string;
	submitNow: string;
	rememberTitle: string;
	rememberBody: string;
	tokenLabel: string;
	tokenPlaceholder: string;
	tokenSubmit: string;
	or: string;
	scanTitle: string;

	// Sign-in messages
	rememberedForgotten: string;
	tokenNotFound: string;
	phoneNotFound: string;
	loginSuccess: string;
	loginFailed: (reason: string) => string;
	verifyFailed: string;
	scanNotTicket: string;
	phoneRequired: string;
	phoneInvalid: string;
	tokenRequired: string;
	tokenFormat: string;
	codeRequired: string;
	respondFailed: string;
	actionFailed: string;
	loggedOut: string;
	loggedOutForgotten: string;
	qrNotReady: string;
	qrDownloaded: string;
	checkedIn: string;
	checkedOut: string;
	withdrawn: string;
	offerAccepted: string;
	offerDeclined: string;

	// Role card
	qrAlt: (code: string) => string;
	roleCardTitle: string;
	volunteerCode: (code: string) => string;
	verified: string;
	unverified: string;
	verifiedBadge: string;
	unverifiedBadge: string;
	onDutyBadge: string;
	offDutyBadge: string;
	benefitsNote: string;
	noQrShort: string;
	noQrLong: string;
	needTokenForQr: string;
	downloadQr: string;
	expandCard: string;
	affiliation: string;
	editProfile: string;
	logoutTitle: string;
	tabSchedule: string;
	tabOpenings: string;
	tabOpeningsSuffix: string;
	defaultName: string;
	defaultAvatar: string;
	defaultRole: string;
	statusOnDuty: string;
	statusReady: string;
	statusAwaiting: string;

	// Schedule list + filters
	listTitle: string;
	listHint: string;
	itemCount: (count: number) => string;
	filterTitle: string;
	fromDate: string;
	toDate: string;
	fromTime: string;
	toTime: string;
	statusFilter: string;
	jobName: string;
	fromDatePlaceholder: string;
	toDatePlaceholder: string;
	fromTimePlaceholder: string;
	toTimePlaceholder: string;
	jobSearchPlaceholder: string;
	jobSearchAria: string;
	clearFilters: string;
	emptyTitle: string;
	emptyBody: string;
	viewOpenings: string;
	noMatchTitle: string;
	noMatchBody: string;
	noDate: string;
	defaultShift: string;
	clockSuffix: string;
	checkInAt: string;
	checkOutAt: string;
	filterOptions: {
		all: string;
		booking: string;
		dispatched: string;
		assigned: string;
		standby: string;
		checked_in: string;
		completed: string;
		no_show: string;
	};
	activityStatus: {
		booking: string;
		dispatched: string;
		assigned: string;
		standby: string;
		checked_in: string;
		completed: string;
		done: string;
		no_show: string;
		cancelled: string;
	};

	// Offers + actions
	offerText: string;
	offerPlaceholder: string;
	offerAria: string;
	accept: string;
	decline: string;
	checkInButton: string;
	checkOutButton: string;
	withdrawButton: string;

	// Rules widget
	rulesTitle: string;
	rule1: string;
	rule2: string;
	rule3: string;
	rule4: string;

	// Leave dialog
	withdrawTitle: string;
	withdrawBody: string;
	withdrawBack: string;
	withdrawConfirm: string;

	// Pass window
	passCloseAria: string;
	passQrAlt: string;
	passShowToStaff: string;
	passClose: string;

	// Ticket & cancellation (#973)
	openTicket: string;
	cancelShift: string;
	cancelShiftAria: (jobTitle: string, period: string) => string;
	confirmCancelTitle: string;
	confirmCancelDescription: string;
	confirmCancelBack: string;
	confirmCancelConfirm: string;
	cancelledSuccess: string;
	cancelFailed: string;
}

export const accessPortalI18n: Record<LanguageCode, AccessPortalTranslations> = {
	th: {
		pageTitleEntry: 'เข้าสู่ระบบอาสาสมัคร — Smart Shelter',
		pageTitleDashboard: 'ตารางงานจิตอาสา — Smart Shelter',
		pageTitleOpenings: 'งานอาสาที่เปิดรับ — Smart Shelter',

		headingSchedule: 'ตารางงานจิตอาสา',
		headingSignIn: 'เข้าสู่ระบบตารางทำงานจิตอาสา',
		signInIntro:
			'กรุณาระบุหมายเลขโทรศัพท์ หรือสแกน QR Code / กรอกรหัส Token เพื่อเข้าสู่ระบบและจัดการตารางงาน',
		restoringTitle: 'กำลังตรวจสอบข้อมูลจิตอาสา…',
		restoringBody: 'กำลังโหลดโปรไฟล์และตารางงานของคุณ',
		tabPhone: 'เข้าสู่ระบบด้วยเบอร์โทรศัพท์',
		tabQr: 'สแกน QR ตั๋ว / รหัส Token',
		phoneLabel: 'หมายเลขโทรศัพท์ที่ลงทะเบียนไว้',
		phonePlaceholder: 'เช่น 081-234-5678',
		phoneHint: 'กรอกเบอร์โทรศัพท์เดียวกันกับที่ลงทะเบียนไว้ในระบบฐานข้อมูลอาสาสมัคร',
		submitChecking: 'กำลังตรวจสอบ…',
		submitNow: 'เข้าสู่ระบบทันที',
		rememberTitle: 'จดจำเครื่องนี้ 7 วัน',
		rememberBody:
			'ครั้งหน้าเปิดหน้านี้แล้วเข้าระบบได้เลยโดยไม่ต้องสแกน — อย่าติ๊กบนเครื่องที่ใช้ร่วมกัน เช่น เครื่องของศูนย์',
		tokenLabel: 'กรอกรหัส Token หรือ รหัสตั๋วจิตอาสา',
		tokenPlaceholder: 'เช่น TKT-VOL-1001 หรือ V-1001',
		tokenSubmit: 'เข้าสู่ระบบ',
		or: 'หรือ',
		scanTitle: 'สแกน QR Code ตั๋วประจำตัวอาสาสมัคร',

		rememberedForgotten:
			'เครื่องนี้ไม่ได้จดจำการเข้าสู่ระบบแล้ว — รหัสตั๋วถูกยกเลิกหรือออกใหม่ กรุณาสแกนตั๋วอีกครั้ง',
		tokenNotFound: 'ไม่พบรหัสตั๋วนี้ในระบบอาสาสมัคร กรุณาตรวจสอบตั๋วแล้วสแกนอีกครั้ง',
		phoneNotFound: 'ไม่พบเบอร์โทรศัพท์นี้ในระบบอาสาสมัคร กรุณาตรวจสอบเบอร์ที่ใช้สมัครอีกครั้ง',
		loginSuccess: 'เข้าสู่ระบบสำเร็จ',
		loginFailed: (reason) => `เข้าสู่ระบบไม่สำเร็จ: ${reason}`,
		verifyFailed: 'ไม่สามารถตรวจสอบข้อมูลจิตอาสาได้',
		scanNotTicket: 'QR Code นี้ไม่ใช่ตั๋วจิตอาสา — กรุณาสแกน QR บนตั๋วหรือบัตรอาสาสมัคร',
		phoneRequired: 'กรุณากรอกเบอร์โทรศัพท์ที่ลงทะเบียนไว้',
		phoneInvalid: 'เบอร์โทรศัพท์ไม่ถูกต้อง',
		tokenRequired: 'กรุณากรอกรหัส Token หรือรหัสตั๋วจิตอาสา',
		tokenFormat: 'รูปแบบรหัสไม่ถูกต้อง — ต้องขึ้นต้นด้วย TKT-VOL-',
		codeRequired: 'กรุณากรอกรหัสที่เจ้าหน้าที่แจ้ง',
		respondFailed: 'ตอบรับงานอาสาสมัครไม่สำเร็จ',
		actionFailed: 'ดำเนินการกับกะงานไม่สำเร็จ',
		loggedOut: 'ออกจากระบบแล้ว',
		loggedOutForgotten: 'ออกจากระบบและลืมเครื่องนี้แล้ว',
		qrNotReady: 'QR Code ยังไม่พร้อมดาวน์โหลด',
		qrDownloaded: 'ดาวน์โหลด QR Role Card เรียบร้อยแล้ว',
		checkedIn: 'เช็คอินเข้าปฏิบัติงานแล้ว',
		checkedOut: 'เช็คเอาต์ออกจากงานแล้ว',
		withdrawn: 'ถอนกะและส่งคำขอลาแล้ว',
		offerAccepted: 'ยอมรับงานอาสาสมัครแล้ว',
		offerDeclined: 'ปฏิเสธงานอาสาสมัครแล้ว',

		qrAlt: (code) => `QR Code รหัสอาสาสมัคร: ${code}`,
		roleCardTitle: 'บัตรอาสาสมัครอัจฉริยะ (QR Role Card)',
		volunteerCode: (code) => `รหัสอาสาสมัคร: ${code}`,
		verified: 'ยืนยันตัวตนแล้ว',
		unverified: 'ยังไม่ยืนยันตัวตน',
		verifiedBadge: '🟢 ยืนยันตัวตนแล้ว',
		unverifiedBadge: '🟡 ยังไม่ยืนยันตัวตน',
		onDutyBadge: '🟢 ปฏิบัติหน้าที่อยู่',
		offDutyBadge: '⚪ ยังไม่ปฏิบัติหน้าที่',
		benefitsNote:
			'คุณสามารถรับสิทธิสวัสดิการ อาหารร้อน น้ำดื่ม และเวชภัณฑ์ที่เจ้าหน้าที่จัดเตรียมไว้ โดยใช้บัตรนี้แสดงต่อเจ้าหน้าที่ ณ จุดแจกจ่าย',
		noQrShort: 'เข้าสู่ระบบด้วยเบอร์โทร ไม่มี QR สำหรับเช็คอิน',
		noQrLong:
			'เข้าสู่ระบบด้วยเบอร์โทร ไม่มี QR สำหรับเช็คอิน — ใช้ QR/รหัส Token ที่ได้รับตอนสมัคร',
		needTokenForQr: 'ใช้ QR หรือรหัส Token ที่ได้รับตอนสมัครเพื่อเปิดบัตรที่เช็คอินได้',
		downloadQr: 'ดาวน์โหลด QR',
		expandCard: 'ขยายบัตร',
		affiliation: 'สังกัด:',
		editProfile: 'แก้ไขโปรไฟล์',
		logoutTitle: 'ออกจากระบบ / ลืมเครื่องนี้',
		tabSchedule: 'ตารางของฉัน',
		tabOpenings: 'งานจิตอาสา',
		tabOpeningsSuffix: '(Openings)',
		defaultName: 'จิตอาสา',
		defaultAvatar: 'อา',
		defaultRole: 'จิตอาสา',
		statusOnDuty: 'ปฏิบัติหน้าที่อยู่',
		statusReady: 'พร้อมปฏิบัติงาน',
		statusAwaiting: 'รอการมอบหมาย',

		listTitle: 'รายการงานอาสาสมัครของฉัน',
		listHint: 'เรียงจากวันที่ใกล้ที่สุดก่อน',
		itemCount: (count) => `${count} รายการ`,
		filterTitle: 'ตัวกรองงานอาสาสมัคร',
		fromDate: 'ตั้งแต่วันที่',
		toDate: 'ถึงวันที่',
		fromTime: 'เวลาตั้งแต่',
		toTime: 'เวลาถึง',
		statusFilter: 'สถานะงาน',
		jobName: 'ชื่องาน',
		fromDatePlaceholder: 'เลือกวันที่เริ่มต้น',
		toDatePlaceholder: 'เลือกวันที่สิ้นสุด',
		fromTimePlaceholder: 'เลือกเวลาเริ่มต้น',
		toTimePlaceholder: 'เลือกเวลาสิ้นสุด',
		jobSearchPlaceholder: 'ค้นหาชื่องาน...',
		jobSearchAria: 'ค้นหาชื่องาน',
		clearFilters: 'ล้างตัวกรอง',
		emptyTitle: 'ตอนนี้ยังไม่มีงานอาสาสมัคร',
		emptyBody: 'เมื่อมีการจองหรือได้รับมอบหมาย งานจะปรากฏรวมกันที่นี่',
		viewOpenings: 'ดูงานจิตอาสา',
		noMatchTitle: 'ไม่พบงานอาสาสมัครตามตัวกรอง',
		noMatchBody: 'ลองขยายช่วงวันที่หรือเวลา แล้วค้นหาใหม่',
		noDate: 'ยังไม่ระบุวัน',
		defaultShift: 'กะงาน',
		clockSuffix: ' น.',
		checkInAt: 'เช็คอิน:',
		checkOutAt: 'เช็คเอาต์:',
		filterOptions: {
			all: 'ทุกสถานะ',
			booking: 'รอเจ้าหน้าที่จัดกะ',
			dispatched: 'รอยืนยันการมอบหมาย',
			assigned: 'รอ Check-in',
			standby: 'รอ Check-in (สำรอง)',
			checked_in: 'กำลังปฏิบัติงาน',
			completed: 'เสร็จสิ้นงานอาสาสมัคร',
			no_show: 'ไม่มาปฏิบัติงาน'
		},
		activityStatus: {
			booking: 'รอเจ้าหน้าที่จัดกะ',
			dispatched: 'รอยืนยันการมอบหมาย',
			assigned: 'รอ Check-in',
			standby: 'รอ Check-in',
			checked_in: 'กำลังปฏิบัติงาน',
			completed: 'เสร็จสิ้นงานอาสาสมัครแล้ว',
			done: 'เสร็จสิ้นงานอาสาสมัครแล้ว',
			no_show: 'ไม่มาปฏิบัติงาน',
			cancelled: 'ถอนกะแล้ว'
		},

		offerText: 'ศูนย์เสนอมอบหมายงานอาสาสมัครนี้ให้คุณ — กรอกรหัสที่เจ้าหน้าที่แจ้ง',
		offerPlaceholder: 'เช่น 4K7-2M9',
		offerAria: 'รหัสยืนยันงานอาสาสมัคร',
		accept: 'ยอมรับงานอาสาสมัคร',
		decline: 'ปฏิเสธงานอาสาสมัคร',
		checkInButton: 'รายงานตัว Check-in',
		checkOutButton: 'เช็คเอาต์ออกจากงาน',
		withdrawButton: 'ขอลา / ถอนกะ',

		rulesTitle: 'กติกาการเข้ากะ',
		rule1: 'กรุณารายงานตัว Check-in ทันทีเมื่อเดินทางมาถึงศูนย์พักพิง',
		rule2:
			'เมื่อปฏิบัติงานอาสาสมัครเสร็จสิ้นตามกรอบเวลา ให้กดปุ่ม Check-out เพื่อสะสมเวลาปฏิบัติงานและคืนข้อมูลทรัพยากร',
		rule3:
			'หากเกิดเหตุฉุกเฉินหรือไม่สามารถเข้าปฏิบัติการได้ตามกำหนด ให้กดคำขอยกเลิกเพื่อให้ผู้จัดการศูนย์พิจารณา',
		rule4: 'ไม่มีการแชร์ข้อมูลส่วนบุคคลของผู้ประสบภัยเพื่อความปลอดภัยของระบบ',

		withdrawTitle: 'ยืนยันการลาและถอนกะ',
		withdrawBody: 'เมื่อยืนยันแล้ว ระบบจะถอนการมอบหมายกะนี้และส่งสถานะการลาให้เจ้าหน้าที่รับทราบ',
		withdrawBack: 'กลับไป',
		withdrawConfirm: 'ยืนยันลาและถอนกะ',

		passCloseAria: 'ปิดบัตร',
		passQrAlt: 'QR Code Pass',
		passShowToStaff: 'ยื่นแสดง QR Code นี้ต่อเจ้าหน้าที่ ณ จุดสแกนเช็คอินศูนย์พักพิง',
		passClose: 'ปิดหน้าต่าง',

		openTicket: 'เปิดตั๋ว',
		cancelShift: 'ยกเลิก',
		cancelShiftAria: (jobTitle: string, period: string) => `ยกเลิกกะ ${jobTitle} (${period})`,
		confirmCancelTitle: 'ยืนยันการยกเลิกกะ',
		confirmCancelDescription:
			'ใบสมัครของกะนี้จะถูกยกเลิก และที่นั่งที่จองไว้จะคืนให้คนอื่น กะอื่นของคุณไม่เปลี่ยน',
		confirmCancelBack: 'กลับไป',
		confirmCancelConfirm: 'ยืนยันยกเลิก',
		cancelledSuccess: 'ยกเลิกกะงานเรียบร้อยแล้ว',
		cancelFailed: 'ยกเลิกกะงานไม่สำเร็จ'
	},
	en: {
		pageTitleEntry: 'Volunteer sign-in — Smart Shelter',
		pageTitleDashboard: 'Volunteer schedule — Smart Shelter',
		pageTitleOpenings: 'Open volunteer jobs — Smart Shelter',

		headingSchedule: 'My volunteer schedule',
		headingSignIn: 'Sign in to your volunteer schedule',
		signInIntro:
			'Enter your phone number, or scan a QR code / enter a token code, to sign in and manage your schedule',
		restoringTitle: 'Checking your volunteer details…',
		restoringBody: 'Loading your profile and schedule',
		tabPhone: 'Sign in with phone number',
		tabQr: 'Scan ticket QR / token code',
		phoneLabel: 'Registered phone number',
		phonePlaceholder: 'e.g. 081-234-5678',
		phoneHint: 'Enter the same phone number you registered with in the volunteer database',
		submitChecking: 'Checking…',
		submitNow: 'Sign in now',
		rememberTitle: 'Remember this device for 7 days',
		rememberBody:
			'Next time you open this page you will be signed in without scanning — do not tick this on a shared device, such as a shelter computer',
		tokenLabel: 'Enter your token code or volunteer ticket code',
		tokenPlaceholder: 'e.g. TKT-VOL-1001 or V-1001',
		tokenSubmit: 'Sign in',
		or: 'or',
		scanTitle: 'Scan the QR code on your volunteer ticket',

		rememberedForgotten:
			'This device no longer remembers your sign-in — the ticket code was cancelled or reissued. Please scan your ticket again',
		tokenNotFound:
			'This ticket code was not found in the volunteer system. Please check your ticket and scan again',
		phoneNotFound:
			'This phone number was not found in the volunteer system. Please check the number you applied with',
		loginSuccess: 'Signed in',
		loginFailed: (reason) => `Could not sign in: ${reason}`,
		verifyFailed: 'Could not check your volunteer details',
		scanNotTicket:
			'This QR code is not a volunteer ticket — please scan the QR on your ticket or volunteer card',
		phoneRequired: 'Please enter the phone number you registered with',
		phoneInvalid: 'Invalid phone number',
		tokenRequired: 'Please enter your token code or volunteer ticket code',
		tokenFormat: 'Invalid code format — it must start with TKT-VOL-',
		codeRequired: 'Please enter the code the staff gave you',
		respondFailed: 'Could not respond to the volunteer job',
		actionFailed: 'Could not complete the shift action',
		loggedOut: 'Signed out',
		loggedOutForgotten: 'Signed out and forgot this device',
		qrNotReady: 'The QR code is not ready to download yet',
		qrDownloaded: 'QR role card downloaded',
		checkedIn: 'Checked in for duty',
		checkedOut: 'Checked out of the job',
		withdrawn: 'Withdrawn from the shift and leave request sent',
		offerAccepted: 'Volunteer job accepted',
		offerDeclined: 'Volunteer job declined',

		qrAlt: (code) => `Volunteer QR code: ${code}`,
		roleCardTitle: 'Smart volunteer card (QR Role Card)',
		volunteerCode: (code) => `Volunteer code: ${code}`,
		verified: 'Verified',
		unverified: 'Not verified',
		verifiedBadge: '🟢 Verified',
		unverifiedBadge: '🟡 Not verified',
		onDutyBadge: '🟢 On duty',
		offDutyBadge: '⚪ Not on duty',
		benefitsNote:
			'You can receive welfare benefits, hot meals, drinking water and medical supplies prepared by staff by showing this card to staff at the distribution point',
		noQrShort: 'Signed in with a phone number, so there is no QR for check-in',
		noQrLong:
			'Signed in with a phone number, so there is no QR for check-in — use the QR / token code you received when you applied',
		needTokenForQr:
			'Use the QR or token code you received when you applied to open a card that can check in',
		downloadQr: 'Download QR',
		expandCard: 'Expand card',
		affiliation: 'Affiliation:',
		editProfile: 'Edit profile',
		logoutTitle: 'Sign out / forget this device',
		tabSchedule: 'My schedule',
		tabOpenings: 'Open volunteer jobs',
		tabOpeningsSuffix: '',
		defaultName: 'Volunteer',
		defaultAvatar: 'VO',
		defaultRole: 'Volunteer',
		statusOnDuty: 'On duty',
		statusReady: 'Ready for duty',
		statusAwaiting: 'Awaiting assignment',

		listTitle: 'My volunteer jobs',
		listHint: 'Sorted by nearest date first',
		itemCount: (count) => `${count} ${count === 1 ? 'item' : 'items'}`,
		filterTitle: 'Filter volunteer jobs',
		fromDate: 'From date',
		toDate: 'To date',
		fromTime: 'From time',
		toTime: 'To time',
		statusFilter: 'Job status',
		jobName: 'Job name',
		fromDatePlaceholder: 'Select start date',
		toDatePlaceholder: 'Select end date',
		fromTimePlaceholder: 'Select start time',
		toTimePlaceholder: 'Select end time',
		jobSearchPlaceholder: 'Search job name...',
		jobSearchAria: 'Search job name',
		clearFilters: 'Clear filters',
		emptyTitle: 'You have no volunteer jobs yet',
		emptyBody: 'Once you book or are assigned, your jobs will appear together here',
		viewOpenings: 'View volunteer jobs',
		noMatchTitle: 'No volunteer jobs match the filters',
		noMatchBody: 'Try widening the date or time range and search again',
		noDate: 'Date not set',
		defaultShift: 'Shift',
		clockSuffix: '',
		checkInAt: 'Check-in:',
		checkOutAt: 'Check-out:',
		filterOptions: {
			all: 'All statuses',
			booking: 'Waiting for staff to assign a shift',
			dispatched: 'Waiting for you to confirm the assignment',
			assigned: 'Waiting for check-in',
			standby: 'Waiting for check-in (standby)',
			checked_in: 'On duty',
			completed: 'Volunteer job finished',
			no_show: 'Did not show up'
		},
		activityStatus: {
			booking: 'Waiting for staff to assign a shift',
			dispatched: 'Waiting for you to confirm the assignment',
			assigned: 'Waiting for check-in',
			standby: 'Waiting for check-in',
			checked_in: 'On duty',
			completed: 'Volunteer job finished',
			done: 'Volunteer job finished',
			no_show: 'Did not show up',
			cancelled: 'Withdrawn from shift'
		},

		offerText: 'The shelter has offered you this volunteer job — enter the code the staff gave you',
		offerPlaceholder: 'e.g. 4K7-2M9',
		offerAria: 'Volunteer job confirmation code',
		accept: 'Accept volunteer job',
		decline: 'Decline volunteer job',
		checkInButton: 'Report in (check-in)',
		checkOutButton: 'Check out of the job',
		withdrawButton: 'Request leave / withdraw from shift',

		rulesTitle: 'Shift rules',
		rule1: 'Please report in (check-in) as soon as you arrive at the shelter',
		rule2:
			'When your volunteer work for the shift is finished, press Check-out so your hours are recorded and resources are returned',
		rule3:
			'In an emergency, or if you cannot make your shift, send a cancellation request for the shelter manager to review',
		rule4: 'Personal data of evacuees is never shared, to keep the system safe',

		withdrawTitle: 'Confirm leave and withdraw from shift',
		withdrawBody:
			'Once confirmed, the system will withdraw your assignment to this shift and tell staff you are on leave',
		withdrawBack: 'Go back',
		withdrawConfirm: 'Confirm leave and withdraw',

		passCloseAria: 'Close card',
		passQrAlt: 'QR Code Pass',
		passShowToStaff: 'Show this QR code to staff at the shelter check-in scan point',
		passClose: 'Close window',

		openTicket: 'Open ticket',
		cancelShift: 'Cancel',
		cancelShiftAria: (jobTitle: string, period: string) =>
			`Cancel shift for ${jobTitle} (${period})`,
		confirmCancelTitle: 'Confirm shift cancellation',
		confirmCancelDescription:
			'Your application for this shift will be cancelled and the reserved slot released to others. Your other shifts remain unchanged.',
		confirmCancelBack: 'Go back',
		confirmCancelConfirm: 'Confirm cancellation',
		cancelledSuccess: 'Shift successfully cancelled',
		cancelFailed: 'Failed to cancel shift'
	}
};
