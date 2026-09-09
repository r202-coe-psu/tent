export const PUBLIC_BOOKING_TICKET_I18N = {
	th: {
		successMsg: 'ทำรายการจองล่วงหน้าสำเร็จ!',
		bookingCodeLabel: 'รหัสการจองของคุณ',
		printBtn: 'พิมพ์ใบจอง',
		saveImageBtn: 'บันทึกเป็นรูปภาพ',
		howToUseLabel: 'วิธีใช้งานใบจองนี้:',
		step1: 'บันทึกภาพหน้าจอนี้ หรือกดปุ่ม "พิมพ์ใบจอง"',
		step2: 'เดินทางไปยังศูนย์พักพิงที่เลือกไว้',
		step3: 'แสดงรหัสการจอง หรือ QR Code ให้เจ้าหน้าที่คัดกรองที่หน้าประตูศูนย์',
		successHeaderTitle: 'จองเข้าศูนย์สำเร็จ',
		successHeaderDesc: 'ระบบกันที่ให้ท่านแล้ว กรุณาบันทึกหรือพิมพ์ใบจองนี้ไว้แสดงที่ประตูศูนย์',
		shelterCodeLabel: 'รหัสศูนย์',
		qrAlt: 'QR สำหรับยืนยันตัวตนที่ประตูศูนย์',
		qrAltUnassigned: 'QR รหัสลงทะเบียนคิวกลาง (ยังไม่ใช่ QR ประตูศูนย์)',
		qrErrorFallback: 'สร้าง QR ไม่สำเร็จ กรุณาแจ้งชื่อ-นามสกุลกับเจ้าหน้าที่ที่ประตูศูนย์',
		qrErrorFallbackUnassigned: 'สร้าง QR ไม่สำเร็จ กรุณาแจ้งเบอร์โทรศัพท์กับเจ้าหน้าที่ลงทะเบียนประจำศูนย์',
		bookerNameLabel: 'ชื่อผู้จอง',
		statusDtLabel: 'สถานะ',
		bookedAtLabel: 'เวลาที่จอง',
		statusPreRegistered: 'ลงทะเบียนล่วงหน้า',
		statusActive: 'เช็คอินเข้าศูนย์แล้ว',
		statusCancelled: 'การจองถูกยกเลิก',
		downloadingBtn: 'กำลังสร้างไฟล์…',
		downloadBtn: 'ดาวน์โหลดใบจอง (PDF)',
		downloadErrorFallback: 'ดาวน์โหลดใบจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
		unassignedSuccessTitle: 'ลงทะเบียนล่วงหน้าสำเร็จ',
		unassignedSuccessDesc:
			'ระบบบันทึกข้อมูลในคิวกลางเรียบร้อยแล้ว กรุณาบันทึกภาพหน้าจอนี้ไว้ แสดง QR หรือแจ้งเบอร์โทรต่อเจ้าหน้าที่ลงทะเบียนประจำศูนย์ — ยังไม่ใช่ QR ประตูศูนย์จนกว่าเจ้าหน้าที่จะรับเข้าศูนย์',
		unassignedNextStepsTitle: 'ขั้นตอนถัดไปเมื่อเดินทางถึงศูนย์:',
		unassignedNextStepsBody:
			'แจ้งเบอร์โทรศัพท์หรือแสดง QR รหัสลงทะเบียนคิวกลางนี้ต่อเจ้าหน้าที่ลงทะเบียนประจำศูนย์ เพื่อรับเข้าศูนย์ (ยังไม่ใช่การสแกน QR ประตูศูนย์ / Station 1)'
	},
	en: {
		successMsg: 'Advance Booking Successful!',
		bookingCodeLabel: 'Your Booking Code',
		printBtn: 'Print Ticket',
		saveImageBtn: 'Save as Image',
		howToUseLabel: 'How to use this ticket:',
		step1: 'Save a screenshot of this page or click "Print Ticket"',
		step2: 'Travel to the selected shelter',
		step3: 'Show this booking code or QR code to the screening staff at the shelter entrance',
		successHeaderTitle: 'Booking Successful',
		successHeaderDesc:
			'Your spot has been reserved. Please save or print this ticket to show at the shelter gate.',
		shelterCodeLabel: 'Shelter Code',
		qrAlt: 'QR code for identity verification at the shelter gate',
		qrAltUnassigned: 'QR code for central-queue registration ID (not a gate Person QR)',
		qrErrorFallback: 'Failed to generate QR code. Please tell staff your full name at the gate.',
		qrErrorFallbackUnassigned:
			'Failed to generate QR code. Please tell registration staff your phone number.',
		bookerNameLabel: "Booker's Name",
		statusDtLabel: 'Status',
		bookedAtLabel: 'Booked At',
		statusPreRegistered: 'Pre-registered',
		statusActive: 'Checked in',
		statusCancelled: 'Booking cancelled',
		downloadingBtn: 'Generating file…',
		downloadBtn: 'Download Ticket (PDF)',
		downloadErrorFallback: 'Failed to download ticket. Please try again.',
		unassignedSuccessTitle: 'Advance registration successful',
		unassignedSuccessDesc:
			'Your details are saved on the central queue. Save this screen and show the QR or phone number to shelter registration staff — this is not a Station-1 / gate Person QR until staff claim you into a shelter.',
		unassignedNextStepsTitle: 'Next steps when you arrive:',
		unassignedNextStepsBody:
			'Give your phone number or this central-queue QR to registration staff so they can claim you into the shelter (not a gate / Station-1 scan yet).'
	}
} as const;
