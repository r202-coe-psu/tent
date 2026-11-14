/**
 * Strings of the kiosk self-checkout (#1401): a card / ThaiD visitor already in the shelter
 * checks themselves and chosen household members out. Nothing here is printed.
 */
const th = {
	pageTitle: 'เช็คเอาต์ — SmartShelter Kiosk',
	heading: 'เช็คเอาต์ออกจากศูนย์',
	ask: {
		title: 'คุณเข้าพักในศูนย์แล้ว',
		body: 'ต้องการเช็คเอาต์ออกจากศูนย์ไหม',
		confirm: 'เช็คเอาต์',
		notMe: 'ไม่ใช่ กลับ'
	},
	members: {
		title: 'เลือกผู้ที่จะเช็คเอาต์',
		holder: 'ผู้ถือบัตร',
		next: 'ถัดไป',
		back: 'ย้อนกลับ',
		selectedNote: (count: number) => `เลือก ${count} คน`
	},
	destination: {
		title: 'จะเดินทางไปที่ไหน',
		home: 'กลับบ้าน',
		other: 'อื่นๆ',
		back: 'ย้อนกลับ'
	},
	confirm: {
		title: (count: number) => `ยืนยันเช็คเอาต์ ${count} คน`,
		destinationLabel: 'ปลายทาง',
		confirm: 'ยืนยัน',
		saving: 'กำลังบันทึก…',
		back: 'ย้อนกลับ',
		home: 'กลับหน้าแรก'
	},
	done: {
		titleAll: 'เช็คเอาต์เรียบร้อยแล้ว',
		titlePartial: 'เช็คเอาต์ได้บางส่วน',
		titleNone: 'เช็คเอาต์ไม่สำเร็จ',
		rowDone: 'เช็คเอาต์แล้ว',
		rowContactStaff: 'ติดต่อเจ้าหน้าที่',
		countdown: (seconds: number) => `กลับหน้าแรกใน ${seconds} วินาที`,
		home: 'กลับหน้าแรก'
	},
	errors: {
		generic: 'บันทึกการเช็คเอาต์ไม่สำเร็จ กรุณาลองอีกครั้ง'
	}
};

const en: typeof th = {
	pageTitle: 'Check out — SmartShelter Kiosk',
	heading: 'Check out of the shelter',
	ask: {
		title: 'You are staying at this shelter',
		body: 'Do you want to check out of the shelter?',
		confirm: 'Check out',
		notMe: 'No, go back'
	},
	members: {
		title: 'Choose who is checking out',
		holder: 'Card holder',
		next: 'Next',
		back: 'Back',
		selectedNote: (count) => `${count} selected`
	},
	destination: {
		title: 'Where are you going?',
		home: 'Going home',
		other: 'Somewhere else',
		back: 'Back'
	},
	confirm: {
		title: (count) => `Confirm checking out ${count} ${count === 1 ? 'person' : 'people'}`,
		destinationLabel: 'Going to',
		confirm: 'Confirm',
		saving: 'Saving…',
		back: 'Back',
		home: 'Back to home'
	},
	done: {
		titleAll: 'Check-out complete',
		titlePartial: 'Only some people were checked out',
		titleNone: 'Check-out did not go through',
		rowDone: 'Checked out',
		rowContactStaff: 'Please contact staff',
		countdown: (seconds) => `Back to home in ${seconds} seconds`,
		home: 'Back to home'
	},
	errors: {
		generic: 'Could not save the check-out. Please try again.'
	}
};

export const KIOSK_SELF_CHECKOUT_I18N = { th, en };
