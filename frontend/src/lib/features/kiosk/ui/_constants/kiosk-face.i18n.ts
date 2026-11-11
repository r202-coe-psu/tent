/** Face check screens: consent, camera, card notice, result. */
const th = {
	consent: {
		badge: 'ตรวจสอบตัวตน',
		heading: 'ตรวจใบหน้าเทียบกับรูปในบัตร',
		purpose:
			'ตู้จะถ่ายภาพใบหน้าของท่านจากกล้อง เพื่อเทียบกับรูปถ่ายในชิปบัตรประชาชนว่าเป็นบุคคลเดียวกันหรือไม่',
		notKeptStrong: 'ภาพใบหน้าจะไม่ถูกบันทึก',
		notKeptRest: 'ระบบเก็บเฉพาะผลการตรวจ (ยืนยันได้ หรือ ยืนยันไม่ได้)',
		declineOk: 'หากไม่ยินยอม ท่านยังรับบริการได้ตามปกติ เจ้าหน้าที่จะตรวจสอบตัวตนให้แทน',
		decline: 'ไม่ยินยอม ให้เจ้าหน้าที่ตรวจแทน',
		agree: 'ยินยอม เริ่มตรวจใบหน้า'
	},
	camera: {
		heading: 'ตรวจสอบใบหน้า',
		verifying: 'กำลังตรวจสอบ…',
		starting: 'กำลังเปิดกล้อง…',
		attempt: (current: number, max: number) => `ครั้งที่ ${current} จาก ${max}`,
		slow: 'หากยังไม่สำเร็จ ระบบจะให้เจ้าหน้าที่ช่วยตรวจ',
		videoLabel: 'ภาพจากกล้อง',
		skip: 'เจ้าหน้าที่ข้ามขั้นตอนนี้'
	},
	cardNotice: {
		removable: 'ถอดบัตรได้แล้ว',
		keepInserted: 'กรุณาเสียบบัตรค้างไว้จนกว่าระบบจะบอกให้ถอด'
	},
	result: {
		matched: 'ยืนยันตัวตนเรียบร้อย',
		staffContinue: 'เจ้าหน้าที่ดำเนินการต่อ',
		cancel: 'ยกเลิก'
	}
};

const en: typeof th = {
	consent: {
		badge: 'Identity check',
		heading: 'Compare your face with the card photo',
		purpose:
			'The kiosk will take a picture of your face with its camera to compare it with the photo on your ID card chip.',
		notKeptStrong: 'Your face image is not saved.',
		notKeptRest: 'Only the result is kept (confirmed or not confirmed).',
		declineOk: 'If you do not agree, you can still get service. Staff will check your identity.',
		decline: 'Decline, staff will check',
		agree: 'Agree, start face check'
	},
	camera: {
		heading: 'Face check',
		verifying: 'Checking…',
		starting: 'Starting camera…',
		attempt: (current, max) => `Attempt ${current} of ${max}`,
		slow: 'If this does not work, staff will help you check.',
		videoLabel: 'Camera view',
		skip: 'Staff skip this step'
	},
	cardNotice: {
		removable: 'You can remove your card now',
		keepInserted: 'Keep your card inserted until told to remove it'
	},
	result: {
		matched: 'Identity confirmed',
		staffContinue: 'Staff continue',
		cancel: 'Cancel'
	}
};

export const KIOSK_FACE_I18N = { th, en };
