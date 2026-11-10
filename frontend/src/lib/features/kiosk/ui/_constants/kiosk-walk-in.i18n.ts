/** Walk-in registration offer shown after a lookup miss. */
const th = {
	offer: {
		title: 'ลงทะเบียนที่ตู้นี้ได้เลย',
		fromThaid: 'ระบบจะใช้ข้อมูลที่ยืนยันผ่าน ThaiD (ไม่มีรูปถ่าย)',
		fromCard: 'ระบบจะใช้ข้อมูลจากบัตรประชาชนที่เสียบอยู่',
		afterwards: 'เมื่อเสร็จแล้วกรุณาไปพบเจ้าหน้าที่เพื่อยืนยันข้อมูล',
		register: 'ลงทะเบียนที่ตู้นี้',
		retryInBefore: 'ค้นหาอีกครั้งได้ใน',
		retryInAfter: 'วินาที',
		searching: 'กำลังค้นหา…',
		retry: 'ลงทะเบียนล่วงหน้าไว้แล้ว? ค้นหาอีกครั้ง'
	}
};

const en: typeof th = {
	offer: {
		title: 'You can register at this kiosk',
		fromThaid: 'We will use the details verified through ThaiD (no photo).',
		fromCard: 'We will use the details from the ID card in the reader.',
		afterwards: 'When you are done, please see staff to confirm your details.',
		register: 'Register at this kiosk',
		retryInBefore: 'Search again in',
		retryInAfter: 'seconds',
		searching: 'Searching…',
		retry: 'Already pre-registered? Search again'
	}
};

export const KIOSK_WALK_IN_I18N = { th, en };
