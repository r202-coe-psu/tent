/** ID-card scanner routes (/kiosk/scanner/*): waiting, reading, remove-card and error screens. */
const th = {
	pageSuffix: 'SmartShelter Kiosk',
	waiting: {
		pageTitle: 'เสียบบัตรประชาชน',
		title: 'เสียบบัตรประชาชน',
		hint: 'หงายบัตรขึ้น · เอาด้านบาร์โค้ดเข้า',
		status: 'รออ่านบัตร · อย่าถอดบัตร',
		slot: 'ช่องเสียบบัตร'
	},
	reading: {
		pageTitle: 'กำลังอ่านบัตร',
		title: 'กำลังอ่านบัตร',
		wait: 'กรุณารอสักครู่',
		privacy: 'ใช้เลขบัตรค้นหาการลงทะเบียนเท่านั้น'
	},
	removeCard: { pageTitle: 'รายงานตัวด้วยบัตรประชาชน' },
	error: {
		pageTitle: 'อ่านบัตรไม่สำเร็จ',
		title: 'อ่านบัตรไม่สำเร็จ',
		fallbackMessage: 'ตรวจสอบการเสียบบัตร แล้วลองอีกครั้ง',
		stepsLabel: 'วิธีลองอีกครั้ง',
		steps: [
			{ title: 'ตรวจว่าเสียบถูกด้าน', hint: 'หงายบัตรขึ้น เอาด้านบาร์โค้ดเข้า แล้วเสียบให้สุด' },
			{ title: 'ถอดบัตรออก เช็ดชิปให้สะอาด', hint: 'ชิปสีทองต้องไม่เปื้อนหรือมีรอย' },
			{ title: 'เสียบบัตรใหม่อีกครั้ง', hint: 'รอจนเครื่องเริ่มอ่านบัตร' }
		],
		help: 'ลองแล้วยังไม่ได้ผล? เรียกเจ้าหน้าที่ให้ช่วย'
	}
};

const en: typeof th = {
	pageSuffix: 'SmartShelter Kiosk',
	waiting: {
		pageTitle: 'Insert your ID card',
		title: 'Insert your ID card',
		hint: 'Card face up · barcode side in',
		status: 'Waiting for card · do not remove it',
		slot: 'Card slot'
	},
	reading: {
		pageTitle: 'Reading your card',
		title: 'Reading your card',
		wait: 'Please wait',
		privacy: 'Your ID number is only used to find your registration'
	},
	removeCard: { pageTitle: 'Check in with your ID card' },
	error: {
		pageTitle: 'Could not read the card',
		title: 'Could not read the card',
		fallbackMessage: 'Check how the card is inserted, then try again',
		stepsLabel: 'How to try again',
		steps: [
			{
				title: 'Check the card is the right way up',
				hint: 'Face up, barcode side in, pushed all the way'
			},
			{
				title: 'Remove the card and wipe the chip',
				hint: 'The gold chip must be clean and unscratched'
			},
			{ title: 'Insert the card again', hint: 'Wait until the reader starts reading' }
		],
		help: 'Still not working? Please ask staff for help'
	}
};

export const KIOSK_SCANNER_I18N = { th, en };
