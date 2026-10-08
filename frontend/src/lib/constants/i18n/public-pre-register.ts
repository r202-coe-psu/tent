export const PUBLIC_PRE_REGISTER_I18N = {
	th: {
		pageTitle: 'ลงทะเบียนเข้าศูนย์พักพิงล่วงหน้า | SmartShelter',
		backHome: 'กลับหน้าหลัก',
		tabTicket: 'ใบลงทะเบียน',
		tabNew: 'ลงทะเบียนใหม่',
		tabHistory: 'ใบลงทะเบียนของฉัน',
		heading: 'ลงทะเบียนเข้าศูนย์พักพิงล่วงหน้า',
		subheading:
			'กรอกข้อมูลตัวท่านและสมาชิกในครอบครัว เพื่ออำนวยความสะดวกในการจัดสรรพื้นที่เข้าพัก เมื่อเดินทางถึงศูนย์พักพิง',
		ticketsClaimedToast:
			'ใบลงทะเบียนได้รับการยืนยันเข้าศูนย์พักพิงแล้ว ระบบได้ลบข้อมูลออกจากอุปกรณ์',
		loadError: 'ไม่สามารถโหลดข้อมูลศูนย์พักพิงได้ กรุณาลองใหม่อีกครั้ง',
		verifiedToast: 'ยืนยันที่ศูนย์แล้ว ระบบได้ลบใบลงทะเบียนออกจากอุปกรณ์เรียบร้อย',
		registerAnother: 'ลงทะเบียนใหม่อีกครอบครัว',
		viewAllTickets: 'ดูใบลงทะเบียนทั้งหมดที่บันทึกไว้',
		loadingShelters: 'กำลังโหลดรายชื่อศูนย์พักพิง…'
	},
	en: {
		pageTitle: 'Pre-register for a shelter | SmartShelter',
		backHome: 'Back to home',
		tabTicket: 'Registration slip',
		tabNew: 'New registration',
		tabHistory: 'My registrations',
		heading: 'Pre-register for a shelter',
		subheading:
			'Enter details for yourself and your family so the shelter can prepare space for you before you arrive.',
		ticketsClaimedToast:
			'Your registration was confirmed at the shelter, so it has been removed from this device.',
		loadError: 'Could not load shelters. Please try again.',
		verifiedToast: 'Confirmed at the shelter. The slip has been removed from this device.',
		registerAnother: 'Register another family',
		viewAllTickets: 'View all saved registrations',
		loadingShelters: 'Loading shelters…'
	}
} as const;

export const PUBLIC_TICKET_HISTORY_I18N = {
	th: {
		ticketsClaimedToast:
			'ใบลงทะเบียนได้รับการยืนยันเข้าศูนย์พักพิงแล้ว ระบบได้ลบข้อมูลออกจากอุปกรณ์',
		confirmRemove: 'คุณต้องการลบใบลงทะเบียนนี้ออกจากเครื่องหรือไม่?',
		confirmVerified:
			'คุณได้นำใบลงทะเบียนนี้ไปรายงานตัวยืนยันเข้าพักที่ศูนย์แล้วใช่หรือไม่?\n\nระบบจะลบใบลงทะเบียนนี้ออกจากอุปกรณ์',
		verifiedToast: 'ยืนยันที่ศูนย์แล้ว ระบบได้ลบใบลงทะเบียนนี้ออกจากอุปกรณ์เรียบร้อย',
		statusVerified:
			'ใบลงทะเบียนนี้ได้รับการยืนยันเข้าศูนย์พักพิงแล้ว ระบบได้ลบข้อมูลออกจากอุปกรณ์เรียบร้อย',
		statusNotFound: 'ไม่พบใบลงทะเบียนนี้ในระบบ (อาจหมดอายุหรือถูกลบแล้ว)',
		statusPending: 'ใบลงทะเบียนนี้ยังอยู่ระหว่างรอการยืนยันเข้าพักที่ศูนย์',
		statusCheckFailed: 'ไม่สามารถตรวจสอบสถานะได้ในขณะนี้',
		backToList: 'กลับไปยังรายการใบลงทะเบียนทั้งหมด',
		title: 'ใบลงทะเบียนของฉัน',
		subtitle: 'แตะเพื่อเปิด QR แสดงเจ้าหน้าที่',
		newBooking: 'ลงทะเบียนใหม่',
		emptyTitle: 'ยังไม่มีใบลงทะเบียน',
		emptyDesc: 'เมื่อลงทะเบียนสำเร็จ QR จะถูกบันทึกที่นี่',
		startBooking: 'ลงทะเบียนเลย',
		unassignedBadge: 'ยังไม่ระบุศูนย์',
		unassignedShelter: 'ไม่ระบุศูนย์พักพิง',
		registrantFallback: 'ผู้ลงทะเบียน',
		checkStatusTitle: 'ตรวจสอบว่าใบลงทะเบียนได้รับการยืนยันที่ศูนย์แล้วหรือยัง',
		checkStatus: 'ตรวจสถานะ',
		markVerifiedTitle: 'ยืนยันว่านำใบลงทะเบียนไปใช้งานแล้ว และลบออกจากอุปกรณ์',
		markVerified: 'ยืนยันแล้ว',
		removeAria: 'ลบใบลงทะเบียน'
	},
	en: {
		ticketsClaimedToast:
			'Your registration was confirmed at the shelter, so it has been removed from this device.',
		confirmRemove: 'Remove this registration slip from this device?',
		confirmVerified:
			'Have you already used this slip to check in at the shelter?\n\nThe slip will be removed from this device.',
		verifiedToast: 'Confirmed at the shelter. The slip has been removed from this device.',
		statusVerified:
			'This registration was confirmed at the shelter, so it has been removed from this device.',
		statusNotFound: 'This registration was not found (it may have expired or been deleted).',
		statusPending: 'This registration is still waiting to be confirmed at the shelter.',
		statusCheckFailed: 'Could not check the status right now.',
		backToList: 'Back to all registration slips',
		title: 'My registration slips',
		subtitle: 'Tap to open the QR for staff',
		newBooking: 'New registration',
		emptyTitle: 'No registration slips yet',
		emptyDesc: 'After you register, the QR is saved here.',
		startBooking: 'Register now',
		unassignedBadge: 'No shelter yet',
		unassignedShelter: 'No shelter selected',
		registrantFallback: 'Registrant',
		checkStatusTitle: 'Check whether this slip has been confirmed at the shelter',
		checkStatus: 'Check status',
		markVerifiedTitle: 'Mark this slip as used and remove it from this device',
		markVerified: 'Confirmed',
		removeAria: 'Remove registration slip'
	}
} as const;
