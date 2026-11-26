/** Volunteer QR print screen. The printed label itself stays Thai. */
const th = {
	pageTitle: 'พิมพ์ QR จิตอาสา — SmartShelter Kiosk',
	heading: 'พิมพ์ QR จิตอาสา',
	phonePrompt: 'กรอกเบอร์โทรที่ลงทะเบียนเป็นจิตอาสา',
	phoneLabel: 'เบอร์โทรศัพท์ที่กรอก',
	phonePlaceholder: 'เบอร์โทรศัพท์',
	searching: 'กำลังค้นหา…',
	search: 'ค้นหา',
	backToChooser: 'กลับไปเลือกวิธีพิมพ์ QR',
	back: 'ย้อนกลับ',
	confirmHeading: 'ใช่คุณหรือไม่',
	badge: (code: string) => `จิตอาสา · ${code}`,
	print: 'พิมพ์ QR',
	notMe: 'ไม่ใช่ฉัน',
	done: {
		title: 'พิมพ์ QR เรียบร้อย',
		body: 'รับ QR Code 1 ดวงที่ช่องพิมพ์ แล้วนำไปให้เจ้าหน้าที่สแกนก่อนเริ่มปฏิบัติงาน',
		home: 'กลับหน้าแรก'
	},
	printFailed: {
		title: 'พิมพ์ไม่สำเร็จ',
		body: (error: string) => `${error} กดพิมพ์อีกครั้ง หรือติดต่อเจ้าหน้าที่`,
		retry: 'ลองพิมพ์อีกครั้ง',
		onScreen: 'แสดง QR บนจอแทน',
		home: 'กลับหน้าแรก'
	},
	/** The same texts for a kiosk without a printer: the QR is shown on screen, nothing is printed. */
	onScreen: {
		pageTitle: 'แสดง QR จิตอาสา — SmartShelter Kiosk',
		heading: 'แสดง QR จิตอาสา',
		backToChooser: 'กลับไปเลือกวิธีแสดง QR',
		show: 'แสดง QR',
		failedTitle: 'แสดง QR ไม่สำเร็จ',
		failedBody: (error: string) => `${error} กดแสดง QR อีกครั้ง หรือติดต่อเจ้าหน้าที่`,
		failedRetry: 'ลองแสดง QR อีกครั้ง'
	}
};

const en: typeof th = {
	pageTitle: 'Print volunteer QR — SmartShelter Kiosk',
	heading: 'Print volunteer QR',
	phonePrompt: 'Enter the phone number registered as a volunteer',
	phoneLabel: 'Phone number entered',
	phonePlaceholder: 'Phone number',
	searching: 'Searching…',
	search: 'Search',
	backToChooser: 'Back to the QR options',
	back: 'Back',
	confirmHeading: 'Is this you?',
	badge: (code) => `Volunteer · ${code}`,
	print: 'Print QR',
	notMe: 'Not me',
	done: {
		title: 'QR printed',
		body: 'Take the QR code from the printer slot and show it to staff to scan before you start work',
		home: 'Back to home'
	},
	printFailed: {
		title: 'Printing failed',
		body: (error) => `${error} Press print to try again, or see staff.`,
		retry: 'Try printing again',
		onScreen: 'Show the QR on screen instead',
		home: 'Back to home'
	},
	onScreen: {
		pageTitle: 'Show volunteer QR — SmartShelter Kiosk',
		heading: 'Show volunteer QR',
		backToChooser: 'Back to the QR options',
		show: 'Show QR',
		failedTitle: 'Could not show the QR',
		failedBody: (error) => `${error} Press show QR to try again, or see staff.`,
		failedRetry: 'Try showing QR again'
	}
};

export const KIOSK_VOLUNTEER_I18N = { th, en };
