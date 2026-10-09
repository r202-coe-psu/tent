export const PUBLIC_BOOKING_TICKET_I18N = {
	th: {
		successHeaderTitle: 'ลงทะเบียนล่วงหน้าสำเร็จ',
		successHeaderDesc:
			'ระบบนับท่านเป็นผู้ที่จะเข้าพักในศูนย์นี้แล้ว แต่ยังต้องผ่านการคัดกรองที่ศูนย์ กรุณาบันทึกใบลงทะเบียนนี้ไว้',
		shelterCodeLabel: 'รหัสศูนย์',
		showQrInstruction: 'แสดง QR Code นี้ต่อเจ้าหน้าที่ เพื่อรับเข้าศูนย์',
		qrAlt: 'QR สำหรับยืนยันตัวตนที่ประตูศูนย์',
		qrAltUnassigned: 'QR สำหรับแสดงต่อเจ้าหน้าที่ลงทะเบียนประจำศูนย์',
		qrErrorFallback: 'สร้าง QR ไม่สำเร็จ กรุณาแจ้งชื่อ-นามสกุลกับเจ้าหน้าที่ที่ประตูศูนย์',
		qrErrorFallbackUnassigned:
			'สร้าง QR ไม่สำเร็จ กรุณาแจ้งเบอร์โทรศัพท์กับเจ้าหน้าที่ลงทะเบียนประจำศูนย์',
		bookerNameLabel: 'ชื่อผู้ลงทะเบียน',
		statusDtLabel: 'สถานะ',
		bookedAtLabel: 'เวลาที่ลงทะเบียน',
		statusPreRegistered: 'ลงทะเบียนล่วงหน้า',
		statusActive: 'เช็คอินเข้าศูนย์แล้ว',
		statusCancelled: 'การลงทะเบียนถูกยกเลิก',
		downloadingBtn: 'กำลังสร้างไฟล์…',
		downloadBtn: 'ดาวน์โหลดใบลงทะเบียน (PDF)',
		downloadErrorFallback: 'ดาวน์โหลดใบลงทะเบียนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
		downloadPngBtn: 'บันทึกเป็นรูปภาพ (PNG)',
		statusAwaitingShelter: 'รอรับเข้าศูนย์พักพิง',
		unassignedShelter: 'ไม่ระบุศูนย์พักพิง',
		unassignedShelterPrint: 'ยังไม่ระบุศูนย์พักพิง',
		memberCountLabel: 'จำนวนสมาชิก',
		memberCountValue: (count: number) => `${count} คน`,
		unassignedSuccessDesc:
			'ระบบบันทึกข้อมูลเรียบร้อยแล้ว แต่ยังไม่ได้ระบุศูนย์ จึงไม่การันตีที่พัก กรุณาบันทึกใบลงทะเบียนนี้ไว้'
	},
	en: {
		successHeaderTitle: 'Pre-registration successful',
		successHeaderDesc:
			'You are now counted as an expected arrival at this shelter, but you still need to pass screening on site. Please keep this slip.',
		shelterCodeLabel: 'Shelter Code',
		showQrInstruction: 'Show this QR code to staff to be admitted to the shelter',
		qrAlt: 'QR code for identity verification at the shelter gate',
		qrAltUnassigned: 'QR code to show shelter registration staff',
		qrErrorFallback: 'Failed to generate QR code. Please tell staff your full name at the gate.',
		qrErrorFallbackUnassigned:
			'Failed to generate QR code. Please tell registration staff your phone number.',
		bookerNameLabel: 'Registrant',
		statusDtLabel: 'Status',
		bookedAtLabel: 'Registered At',
		statusPreRegistered: 'Pre-registered',
		statusActive: 'Checked in',
		statusCancelled: 'Pre-registration cancelled',
		downloadingBtn: 'Generating file…',
		downloadBtn: 'Download Slip (PDF)',
		downloadErrorFallback: 'Failed to download slip. Please try again.',
		downloadPngBtn: 'Save as image (PNG)',
		statusAwaitingShelter: 'Awaiting shelter admission',
		unassignedShelter: 'No shelter selected',
		unassignedShelterPrint: 'No shelter selected yet',
		memberCountLabel: 'Members',
		memberCountValue: (count: number) => `${count} ${count === 1 ? 'person' : 'people'}`,
		unassignedSuccessDesc:
			'Your details are saved, but no shelter was chosen, so a place is not guaranteed. Please keep this slip.'
	}
} as const;
