/** Method-selection screen (/kiosk): the three ways to find a registration, plus the QR print entry. */
const th = {
	title: 'ลงทะเบียน',
	subtitle: 'เลือกวิธีค้นหา',
	gridLabel: 'วิธีค้นหาข้อมูล',
	methods: {
		qr: {
			title: 'QR ลงทะเบียน',
			description: 'สแกน QR ที่ได้รับจากการลงทะเบียนล่วงหน้า',
			buttonLabel: 'สแกน QR'
		},
		'smart-card': {
			title: 'บัตรประชาชน',
			description: 'เสียบบัตรที่ใช้ลงทะเบียน',
			buttonLabel: 'เสียบบัตร'
		},
		thaid: {
			title: 'ThaiD',
			description: 'สแกน QR ด้วยมือถือแล้วยืนยันในแอป ThaiD',
			buttonLabel: 'ใช้ ThaiD'
		}
	},
	reprint: {
		title: 'พิมพ์ QR',
		description: 'กรอกเบอร์โทรที่ลงทะเบียนไว้ เพื่อพิมพ์ QR Code'
	}
};

const en: typeof th = {
	title: 'Registration',
	subtitle: 'Choose how to find your record',
	gridLabel: 'Ways to find your record',
	methods: {
		qr: {
			title: 'Registration QR',
			description: 'Scan the QR from your pre-registration',
			buttonLabel: 'Scan QR'
		},
		'smart-card': {
			title: 'Thai ID card',
			description: 'Insert the card you registered with',
			buttonLabel: 'Insert card'
		},
		thaid: {
			title: 'ThaiD',
			description: 'Scan the QR with your phone, then confirm in the ThaiD app',
			buttonLabel: 'Use ThaiD'
		}
	},
	reprint: {
		title: 'Print QR',
		description: 'Enter your registered phone number to print your QR Code'
	}
};

export const KIOSK_METHOD_I18N = { th, en };
