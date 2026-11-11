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
		home: 'กลับหน้าแรก'
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
		home: 'Back to home'
	}
};

export const KIOSK_VOLUNTEER_I18N = { th, en };
