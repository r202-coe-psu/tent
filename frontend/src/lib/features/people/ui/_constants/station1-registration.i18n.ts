const th = {
	duplicate: {
		publicPhoneTitle: 'เบอร์โทรศัพท์นี้มีข้อมูลในระบบแล้ว',
		publicIdTitle: 'เลขประจำตัวประชาชนนี้มีข้อมูลในระบบแล้ว',
		staffPhoneTitle: 'พบข้อมูลเบอร์โทรศัพท์ซ้ำในระบบ',
		staffIdTitle: 'พบข้อมูลซ้ำในระบบ',
		publicPhoneDesc:
			'ตรวจพบเบอร์โทรศัพท์นี้มีการลงทะเบียนในระบบแล้ว หากท่านเคยลงทะเบียนไว้แล้ว สามารถใช้เบอร์โทรศัพท์ตรวจสอบสถานะได้ที่หน้าประวัติ',
		publicIdDesc:
			'ตรวจพบเลขประจำตัวประชาชนนี้มีการลงทะเบียนในระบบแล้ว หากท่านเคยลงทะเบียนไว้แล้ว สามารถตรวจสอบสถานะได้ที่หน้าประวัติ',
		staffPhonePrefix: 'ตรวจพบเบอร์โทรศัพท์',
		staffIdPrefix: 'ตรวจพบเลขบัตรประชาชน',
		staffSuffix: 'มีข้อมูลผู้ประสบภัยอยู่ในระบบแล้ว กรุณาตรวจสอบก่อนกรอกข้อมูลซ้ำ',
		thisShelter: 'ศูนย์นี้',
		centralQueue: 'คิวกลาง',
		idCardLabel: 'เลขบัตรประชาชน:',
		phoneLabel: 'เบอร์โทร:',
		acknowledge: 'รับทราบ / ปิด',
		notThisPerson: 'ไม่ใช่คนนี้ / กรอกต่อ',
		goToExisting: 'ไปที่ข้อมูลเดิม / เช็คอิน',
		shelterStatusPrefix: 'ในศูนย์พักพิง',
		poolStatus: 'คิวกลาง — ลงทะเบียนออนไลน์'
	},
	pull: {
		title: 'ดึงข้อมูลจากคิวลงทะเบียนล่วงหน้า',
		description:
			'เลือกผู้ประสบภัยที่สแกนบัตร Kiosk หรือลงทะเบียนออนไลน์ล่วงหน้าไว้ เพื่อดึงเข้าครอบครัวนี้',
		searchPlaceholder: 'ค้นหาด้วยชื่อ, นามสกุล, เลขบัตรประชาชน 13 หลัก, หรือเบอร์โทร...',
		clearSearchAria: 'ล้างคำค้นหา',
		all: 'ทั้งหมด',
		channelKiosk: 'ตู้ Kiosk',
		channelWeb: 'ออนไลน์ Web',
		loading: 'กำลังโหลดคิวลงทะเบียนล่วงหน้า...',
		emptyTitle: 'ไม่พบรายชื่อในคิวลงทะเบียนล่วงหน้า',
		emptyFiltered: 'ไม่พบข้อมูลที่ตรงกับคำค้นหาหรือตัวกรองที่เลือก',
		emptyNone: 'ไม่มีผู้ที่สแกนบัตรหรือจองออนไลน์ค้างอยู่ในระบบ',
		idCardLabel: 'เลขบัตร:',
		phoneLabel: 'โทร:',
		timeLabel: (time: string) => `เวลา ${time} น.`,
		selectPerson: 'เลือกคนนี้',
		cancel: 'ยกเลิก'
	},
	batch: {
		title: 'ลงทะเบียนสำเร็จ',
		subtitle: 'พิมพ์บัตรด้านล่างทีละใบ (Person QR ของทุกคน) แล้วส่งต่อไปขั้นถัดไป',
		toMedical: 'ไปคัดกรองผู้เข้าพัก (สถานี 2)',
		toZoning: 'ไปจัดโซน (สถานี 3)',
		factFamily: 'ครอบครัว',
		factCount: 'จำนวน',
		count: (n: number) => `${n} คน`,
		factStatus: 'สถานะ',
		statusValue: 'รายงานตัวแล้ว · รอเข้าพัก',
		factNext: 'ขั้นถัดไป',
		nextMedical: 'คัดกรองผู้เข้าพัก (สถานี 2)',
		nextZoning: 'จัดโซน (สถานี 3)',
		registerAnother: 'ลงทะเบียนครอบครัวถัดไป',
		backToQueue: 'กลับคิวทะเบียน',
		member: 'สมาชิก'
	},
	memberCard: {
		pulledToast: (name: string) => `ดึงข้อมูลคุณ ${name} จากคิวสำเร็จ`,
		unlinkedToast: 'ล้างข้อมูลและยกเลิกการเชื่อมโยงเรียบร้อยแล้ว',
		badgePreRegistered: 'ลงทะเบียนล่วงหน้า',
		badgeNewMember: 'สมาชิกใหม่ (รายงานตัวทันที)',
		alreadyReportedIn: 'เข้ารายงานตัวแล้ว',
		reportingThisRound: 'รายงานตัวรอบนี้',
		pullFromQueue: 'ดึงข้อมูลจากคิว',
		selectedReporting: 'เลือกแล้ว — รายงานตัวรอบนี้',
		notSelected: 'ยังไม่เลือก — ไม่มาในรอบนี้',
		unlinkPull: 'ยกเลิกการดึง',
		preferredZoneTitle: 'โซนที่ต้องการ (ไม่บังคับ)',
		preferredZoneHint: 'เป็นค่าแนะนำให้จุดจัดโซน (สถานี 3) — ทุกคนยังต้องผ่านจุดคัดกรองและจัดโซน',
		noOpenZones: 'ศูนย์นี้ยังไม่มีโซนที่เปิดใช้งาน',
		preferredZoneAria: 'โซนที่ต้องการ',
		unspecified: 'ไม่ระบุ'
	},
	saveError: {
		copied: 'คัดลอกรายละเอียดข้อผิดพลาดแล้ว',
		copyFailed: 'ไม่สามารถคัดลอกได้',
		dismissAria: 'ปิดการแจ้งเตือน',
		note: 'ข้อมูลที่บันทึกค้างระหว่างทางถูกลบหรือยกเลิกแล้ว (ถ้าทำได้) กรุณาคัดลอกรายละเอียดด้านล่างส่งให้นักพัฒนา',
		copy: 'คัดลอก'
	}
};

const en: typeof th = {
	duplicate: {
		publicPhoneTitle: 'This phone number is already in the system',
		publicIdTitle: 'This national ID number is already in the system',
		staffPhoneTitle: 'Duplicate phone number found in the system',
		staffIdTitle: 'Duplicate record found in the system',
		publicPhoneDesc:
			'This phone number is already registered. If you have registered before, you can check your status on the history page using your phone number.',
		publicIdDesc:
			'This national ID number is already registered. If you have registered before, you can check your status on the history page.',
		staffPhonePrefix: 'The phone number',
		staffIdPrefix: 'The national ID number',
		staffSuffix:
			'already has an evacuee record in the system. Please check before entering it again.',
		thisShelter: 'This shelter',
		centralQueue: 'Central queue',
		idCardLabel: 'National ID:',
		phoneLabel: 'Phone:',
		acknowledge: 'Got it / Close',
		notThisPerson: 'Not this person / Continue',
		goToExisting: 'Go to existing record / Check in',
		shelterStatusPrefix: 'In shelter',
		poolStatus: 'Central queue — registered online'
	},
	pull: {
		title: 'Pull from the pre-registration queue',
		description:
			'Select an evacuee who scanned their card at the kiosk or pre-registered online, to add them to this family.',
		searchPlaceholder: 'Search by first name, last name, 13-digit national ID, or phone...',
		clearSearchAria: 'Clear search',
		all: 'All',
		channelKiosk: 'Kiosk',
		channelWeb: 'Online (Web)',
		loading: 'Loading the pre-registration queue...',
		emptyTitle: 'No one found in the pre-registration queue',
		emptyFiltered: 'No records match the search or the selected filter',
		emptyNone: 'No one is waiting in the system after a card scan or online booking',
		idCardLabel: 'ID no.:',
		phoneLabel: 'Phone:',
		timeLabel: (time: string) => `Time ${time}`,
		selectPerson: 'Select this person',
		cancel: 'Cancel'
	},
	batch: {
		title: 'Registration complete',
		subtitle:
			'Print the cards below one by one (everyone’s Person QR), then move on to the next step',
		toMedical: 'Go to health screening (Station 2)',
		toZoning: 'Go to zoning (Station 3)',
		factFamily: 'Family',
		factCount: 'Count',
		count: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
		factStatus: 'Status',
		statusValue: 'Reported in · awaiting check-in',
		factNext: 'Next step',
		nextMedical: 'Health screening (Station 2)',
		nextZoning: 'Zoning (Station 3)',
		registerAnother: 'Register the next family',
		backToQueue: 'Back to registration queue',
		member: 'Member'
	},
	memberCard: {
		pulledToast: (name: string) => `Pulled ${name}'s details from the queue`,
		unlinkedToast: 'Data cleared and the link to the queue entry was removed',
		badgePreRegistered: 'Pre-registered',
		badgeNewMember: 'New member (report in now)',
		alreadyReportedIn: 'Already reported in',
		reportingThisRound: 'Reporting in this round',
		pullFromQueue: 'Pull from queue',
		selectedReporting: 'Selected — reporting in this round',
		notSelected: 'Not selected — not coming this round',
		unlinkPull: 'Undo pull',
		preferredZoneTitle: 'Preferred zone (optional)',
		preferredZoneHint:
			'A suggestion for the zoning desk (Station 3) — everyone still goes through screening and zoning',
		noOpenZones: 'This shelter has no active zones yet',
		preferredZoneAria: 'Preferred zone',
		unspecified: 'Not specified'
	},
	saveError: {
		copied: 'Error details copied',
		copyFailed: 'Could not copy',
		dismissAria: 'Dismiss alert',
		note: 'Data saved partway through has been deleted or rolled back (where possible). Please copy the details below and send them to the developers.',
		copy: 'Copy'
	}
};

export const STATION1_REGISTRATION_I18N = { th, en };
