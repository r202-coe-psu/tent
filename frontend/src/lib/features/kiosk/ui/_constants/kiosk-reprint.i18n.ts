import {
	localizeReprintReason,
	REPRINT_PRE_REGISTERED_REASON,
	REPRINT_TEMPORARY_LEAVE_REASON
} from '../../domain/check-in-status';

/** The QR reprint flow: phone, household, members, last four digits, staff PIN, result. */
const th = {
	pageTitle: 'พิมพ์ QR — SmartShelter Kiosk',
	back: 'ย้อนกลับ',
	phone: {
		heading: 'พิมพ์ QR',
		hint: 'กรอกเบอร์โทรที่ลงทะเบียนไว้',
		displayLabel: 'เบอร์โทรศัพท์ที่กรอก',
		placeholder: 'เบอร์โทรศัพท์',
		searching: 'กำลังค้นหา…',
		search: 'ค้นหา',
		notRegistered: 'ยังไม่เคยลงทะเบียน? ใช้ QR บัตรประชาชน หรือ ThaiD ที่หน้าแรก'
	},
	members: {
		blockedTitle: 'ยังไม่มี QR ให้พิมพ์',
		next: (count: number) => `ต่อไป · ${count} คน`
	},
	staffPin: {
		description: 'ตรวจบัตรประชาชนกับตัวบุคคลแล้ว กรอก PIN 6 หลักเพื่อพิมพ์ QR'
	},
	verify: {
		heading: 'กรอกเลขบัตรประชาชน 4 ตัวท้ายของเจ้าของเบอร์',
		digitsLabel: (entered: number, total: number) => `กรอกแล้ว ${entered} จาก ${total} หลัก`,
		checking: 'กำลังตรวจสอบ…',
		confirm: 'ยืนยันและพิมพ์',
		staffPin: 'ให้เจ้าหน้าที่ยืนยันด้วย PIN'
	},
	done: {
		title: 'พิมพ์ QR เรียบร้อย',
		body: (count: number) => `รับ QR Code ${count} ดวงที่ช่องพิมพ์ แล้วไปที่จุดคัดกรอง`,
		qrIssueFailed: (count: number) =>
			`ออก QR ไม่สำเร็จ ${count} คน (ยังไม่ได้พิมพ์) กรุณาลองพิมพ์ใหม่หรือติดต่อเจ้าหน้าที่`,
		home: 'กลับหน้าแรก'
	},
	failed: {
		title: 'พิมพ์ไม่สำเร็จ',
		body: (error: string) => `${error} กดพิมพ์อีกครั้ง หรือติดต่อเจ้าหน้าที่`,
		retry: 'พิมพ์อีกครั้ง',
		home: 'กลับหน้าแรก'
	},
	memberList: {
		heading: 'เลือกสมาชิกที่ต้องการพิมพ์ QR',
		nameMasked: 'ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว',
		selectAll: 'เลือกทั้งหมด',
		clearAll: 'ยกเลิกทั้งหมด',
		noName: 'ไม่ระบุชื่อ',
		ageUnknown: 'ไม่ระบุอายุ',
		age: (years: number) => `${years} ปี`,
		arriving: 'รายงานตัวแล้ว · รอคัดกรอง',
		room_confirmed: 'ยืนยันที่พักแล้ว',
		active: 'เข้าพักแล้ว',
		preRegisteredReason: REPRINT_PRE_REGISTERED_REASON,
		temporaryLeaveReason: REPRINT_TEMPORARY_LEAVE_REASON
	}
};

const en: typeof th = {
	pageTitle: 'Print QR — SmartShelter Kiosk',
	back: 'Go back',
	phone: {
		heading: 'Print QR',
		hint: 'Enter the phone number you registered with',
		displayLabel: 'Phone number entered',
		placeholder: 'Phone number',
		searching: 'Searching…',
		search: 'Search',
		notRegistered: 'Not registered yet? Use your ID card QR or ThaiD on the home page'
	},
	members: {
		blockedTitle: 'No QR to print yet',
		next: (count: number) => `Next · ${count} ${count === 1 ? 'person' : 'people'}`
	},
	staffPin: {
		description: 'Check the ID card against the person, then enter the 6-digit PIN to print the QR'
	},
	verify: {
		heading: "Enter the last 4 digits of the phone owner's ID number",
		digitsLabel: (entered: number, total: number) => `${entered} of ${total} digits entered`,
		checking: 'Checking…',
		confirm: 'Confirm and print',
		staffPin: 'Staff: confirm with PIN'
	},
	done: {
		title: 'QR printed',
		body: (count: number) =>
			`Take your ${count} QR Code ${count === 1 ? 'label' : 'labels'} at the print slot, then go to the screening point`,
		qrIssueFailed: (count: number) =>
			`Could not issue a QR for ${count} ${count === 1 ? 'person' : 'people'} (not printed). Please print again or contact staff.`,
		home: 'Back to home'
	},
	failed: {
		title: 'Printing failed',
		body: (error: string) => `${error} Press print again or contact staff.`,
		retry: 'Print again',
		home: 'Back to home'
	},
	memberList: {
		heading: 'Choose members to print a QR for',
		nameMasked: 'Names are partly hidden for privacy',
		selectAll: 'Select all',
		clearAll: 'Clear all',
		noName: 'Name not given',
		ageUnknown: 'Age not given',
		age: (years: number) => `${years} yrs`,
		arriving: 'Checked in · awaiting screening',
		room_confirmed: 'Room confirmed',
		active: 'Staying at the shelter',
		preRegisteredReason: localizeReprintReason(REPRINT_PRE_REGISTERED_REASON, 'en'),
		temporaryLeaveReason: localizeReprintReason(REPRINT_TEMPORARY_LEAVE_REASON, 'en')
	}
};

export const KIOSK_REPRINT_I18N = { th, en };
