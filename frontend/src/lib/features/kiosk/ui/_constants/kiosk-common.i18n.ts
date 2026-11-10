/** Strings shared by the kiosk shell and its reusable widgets (wizard, back button, numpad, PIN entry). */
const th = {
	shell: {
		shelterPrefix: (name: string) => `ศูนย์พักพิง ${name}`,
		shelterAria: (shelter: string, code: string, station: string, device: string) =>
			`ศูนย์พักพิง ${shelter} ${code} จุดบริการ ${station} เครื่อง ${device}`,
		clockAria: (date: string, time: string) => `เวลาปัจจุบัน ${date} ${time}`
	},
	wizard: {
		navLabel: 'ขั้นตอนรายงานตัว',
		listLabel: '5 ขั้นตอน',
		progress: (step: number, label: string) => `ขั้น ${step} จาก 5 · ${label}`,
		method: 'วิธีค้นหา',
		scan: 'สแกน',
		lookup: 'ค้นหา',
		members: 'สมาชิก',
		done: 'เสร็จสิ้น'
	},
	back: { label: 'กลับหน้าเริ่มต้น', text: 'กลับ' },
	numpad: {
		group: 'ปุ่มกดตัวเลข',
		digit: (digit: string) => `ตัวเลข ${digit}`,
		clearAllLabel: 'ล้างทั้งหมด',
		clear: 'ล้าง',
		deleteOneLabel: 'ลบหนึ่งตัว',
		delete: 'ลบ'
	},
	lookupActions: {
		scanAgain: 'สแกนใหม่',
		enterPhoneAgain: 'กรอกเบอร์ใหม่',
		retryInBefore: 'ลองอีกครั้งใน',
		retryInAfter: 'วินาที',
		searching: 'กำลังค้นหา…',
		retry: 'ลองอีกครั้ง',
		back: 'กลับ'
	},
	staffPin: {
		heading: 'สำหรับเจ้าหน้าที่',
		defaultDescription: 'ตรวจบัตรประชาชนกับตัวบุคคลแล้ว กรอก PIN 6 หลักเพื่อดำเนินการต่อ',
		entered: (entered: number, total: number) => `กรอก PIN แล้ว ${entered} จาก ${total} หลัก`,
		checking: 'กำลังตรวจสอบ…',
		confirm: 'ยืนยัน',
		cancel: 'ยกเลิก',
		wrong: 'PIN ไม่ถูกต้อง กรุณาลองใหม่',
		failed: 'ตรวจสอบ PIN ไม่สำเร็จ กรุณาลองใหม่',
		blocked: 'ยังข้ามขั้นตอนนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ'
	},
	deviceInfo: {
		openLabel: 'ข้อมูลเครื่อง',
		pinDialogLabel: 'PIN เจ้าหน้าที่สำหรับดูข้อมูลเครื่อง',
		pinDescription: 'กรอก PIN 6 หลักเพื่อดูข้อมูลเครื่อง',
		title: 'ข้อมูลเครื่อง',
		deviceName: 'ชื่อเครื่อง',
		shelter: 'ศูนย์พักพิง',
		station: 'จุดบริการ',
		staffPin: 'PIN เจ้าหน้าที่',
		hidePin: 'ซ่อน PIN',
		showPin: 'แสดง PIN',
		pinDefault: 'ยังเป็นค่าเริ่มต้น',
		pinSet: 'ตั้งแล้ว',
		updated: (when: string) => `อัปเดต ${when}`,
		noGroup: 'ไม่ได้อยู่ในกลุ่ม',
		screen: 'หน้าจอ',
		screenCompact: 'ตู้เล็ก',
		screenPortrait: 'ตู้ใหญ่',
		testPrintFailed: (reason: string) => `ทดสอบการพิมพ์ไม่สำเร็จ: ${reason}`,
		testPrint: 'ทดสอบการพิมพ์',
		close: 'ปิด'
	}
};

const en: typeof th = {
	shell: {
		shelterPrefix: (name: string) => `Shelter ${name}`,
		shelterAria: (shelter: string, code: string, station: string, device: string) =>
			`Shelter ${shelter} ${code} service point ${station} device ${device}`,
		clockAria: (date: string, time: string) => `Current time ${date} ${time}`
	},
	wizard: {
		navLabel: 'Check-in steps',
		listLabel: '5 steps',
		progress: (step: number, label: string) => `Step ${step} of 5 · ${label}`,
		method: 'Method',
		scan: 'Scan',
		lookup: 'Look up',
		members: 'Members',
		done: 'Done'
	},
	back: { label: 'Back to start', text: 'Back' },
	numpad: {
		group: 'Number keypad',
		digit: (digit: string) => `Digit ${digit}`,
		clearAllLabel: 'Clear all',
		clear: 'Clear',
		deleteOneLabel: 'Delete one digit',
		delete: 'Delete'
	},
	lookupActions: {
		scanAgain: 'Scan again',
		enterPhoneAgain: 'Enter number again',
		retryInBefore: 'Try again in',
		retryInAfter: 'seconds',
		searching: 'Searching…',
		retry: 'Try again',
		back: 'Back'
	},
	staffPin: {
		heading: 'Staff only',
		defaultDescription: 'ID card and person checked. Enter the 6-digit PIN to continue',
		entered: (entered: number, total: number) => `PIN entered: ${entered} of ${total} digits`,
		checking: 'Checking…',
		confirm: 'Confirm',
		cancel: 'Cancel',
		wrong: 'Incorrect PIN. Please try again',
		failed: 'Could not check the PIN. Please try again',
		blocked: 'This step cannot be skipped yet. Please contact the administrator'
	},
	deviceInfo: {
		openLabel: 'Device info',
		pinDialogLabel: 'Staff PIN to view device info',
		pinDescription: 'Enter the 6-digit PIN to view device info',
		title: 'Device info',
		deviceName: 'Device name',
		shelter: 'Shelter',
		station: 'Service point',
		staffPin: 'Staff PIN',
		hidePin: 'Hide PIN',
		showPin: 'Show PIN',
		pinDefault: 'Still the default',
		pinSet: 'Set',
		updated: (when: string) => `Updated ${when}`,
		noGroup: 'Not in a group',
		screen: 'Screen',
		screenCompact: 'Small kiosk',
		screenPortrait: 'Large kiosk',
		testPrintFailed: (reason: string) => `Test print failed: ${reason}`,
		testPrint: 'Test print',
		close: 'Close'
	}
};

export const KIOSK_COMMON_I18N = { th, en };
