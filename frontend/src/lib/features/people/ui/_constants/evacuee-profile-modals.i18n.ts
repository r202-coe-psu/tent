const th = {
	status: {
		title: 'แก้ไขสถานะการพักพิง (Stay status)',
		groupAria: 'สถานะการพักพิง',
		reason: 'เหตุผล',
		reasonPlaceholder: 'ระบุเหตุผล เช่น กลับบ้านชั่วคราว / ย้ายออก',
		cancel: 'ยกเลิก',
		confirm: 'ยืนยัน',
		saving: 'กำลังบันทึก...',
		checkedOutReasonRequired: 'การเช็คเอาท์ต้องระบุเหตุผลหรือหมายเหตุ',
		leaveReasonRequired: 'การออกชั่วคราวต้องระบุเหตุผล'
	},
	zone: {
		title: 'ย้ายโซนที่พัก (Change stay zone)',
		cancel: 'ยกเลิก',
		confirm: 'ยืนยันย้ายโซน',
		saving: 'กำลังบันทึก...'
	},
	emergency: {
		title: 'แก้ไขผู้ติดต่อฉุกเฉิน',
		close: 'ปิด',
		cancel: 'ยกเลิก',
		save: 'บันทึกผู้ติดต่อ',
		saving: 'กำลังบันทึก...',
		invalidForm: 'กรุณากรอกข้อมูลผู้ติดต่อให้ถูกต้องและครบถ้วน',
		incompleteContact: 'กรุณากรอกชื่อ เบอร์โทร 10 หลัก และความสัมพันธ์ให้ครบ'
	},
	assets: {
		title: 'แก้ไขทรัพย์สินและสัตว์เลี้ยง (Assets & Pets)',
		cancel: 'ยกเลิก',
		save: 'บันทึกข้อมูล',
		saving: 'กำลังบันทึก...'
	},
	address: {
		title: 'แก้ไขที่อยู่ครอบครัว',
		close: 'ปิด',
		municipalityZone: 'เขตเทศบาล',
		municipalityZonePlaceholder: 'ระบุเขตเทศบาล...',
		community: 'ชุมชน',
		communityPlaceholder: 'ระบุชุมชน...',
		saveFailed: 'บันทึกข้อมูลไม่สำเร็จ',
		cancel: 'ยกเลิก',
		save: 'บันทึกข้อมูล',
		saving: 'กำลังบันทึก...'
	},
	personal: {
		title: 'แก้ไขข้อมูลส่วนบุคคล',
		subtitle: 'ข้อมูลระบุตัวตนและช่องทางติดต่อหลัก',
		close: 'ปิด',
		photo: 'รูปถ่าย',
		photoAlt: 'ตัวอย่างรูปผู้พักพิง',
		choosePhoto: 'เลือกรูป',
		removePhoto: 'ลบรูป',
		cancel: 'ยกเลิก',
		save: 'บันทึกข้อมูลส่วนบุคคล',
		saving: 'กำลังบันทึก...',
		invalidForm: 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน',
		invalidPhone: 'กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลือกไม่มีเบอร์โทร',
		invalidNationalId: 'เลขประจำตัวประชาชนต้องมี 13 หลัก',
		invalidAge: 'อายุต้องอยู่ระหว่าง 0 ถึง 150 ปี'
	},
	household: {
		title: 'แก้ไขสังกัดครัวเรือน',
		close: 'ปิด',
		household: 'ครัวเรือน',
		selectedAffiliation: 'สังกัดที่เลือก',
		noHousehold: 'ไม่สังกัดครัวเรือน',
		searchPlaceholder: 'ค้นหาด้วยเบอร์โทร หรือชื่อสมาชิกในครัวเรือน',
		scanQr: 'สแกน QR',
		searching: 'กำลังค้นหา...',
		noJoinableMembers: 'ไม่พบสมาชิกที่มีครัวเรือนที่เข้าร่วมได้',
		hitHousehold: (label: string) => `ครัวเรือน: ${label}`,
		setAsHead: 'ตั้งเป็นหัวหน้าครัวเรือน',
		cancel: 'ยกเลิก',
		save: 'บันทึกสังกัดครัวเรือน',
		saving: 'กำลังบันทึก...',
		qrNotFound: 'ไม่พบข้อมูลผู้พักพิงจาก QR',
		noHouseholdFor: (name: string) => `${name} ยังไม่ได้สังกัดครัวเรือน`,
		cannotJoin: 'ไม่สามารถเข้าร่วมครัวเรือนนี้ได้ (สถานะไม่พร้อมหรือไม่อยู่ในศูนย์)',
		selectedHousehold: (label: string) => `เลือกครัวเรือน: ${label}`,
		qrReadError: 'เกิดข้อผิดพลาดในการอ่าน QR'
	},
	health: {
		title: 'แก้ไขข้อมูลสุขภาพ (Station 2 Occupant Screening)',
		closeAria: 'ปิดหน้าต่างแก้ไขข้อมูลสุขภาพ',
		close: 'ปิด',
		historyTitle: '1. ประวัติสุขภาพและแนวทางดูแล (Health History & Care Track)',
		historyDesc: 'กำหนดแนวทางดูแล ซักประวัติโรคประจำตัว ยาที่ใช้ประจำ ประวัติการแพ้ และอาการทั่วไป',
		vulnerableTitle: '2. กลุ่มเปราะบาง (Vulnerable Groups)',
		vulnerableDesc: 'เลือกได้หลายรายการ (ไม่บังคับ)',
		specialNeedsTitle: '3. ความต้องการพิเศษ (Special needs)',
		specialNeedsDesc: 'แท็กทั่วไปหรือเพิ่มความต้องการพิเศษเอง (ไม่บังคับ)',
		ewarTitle: '4. อาการเฝ้าระวังทางระบาดวิทยา (EWAR Surveillance Symptoms)',
		ewarDesc: 'กลุ่มอาการเฝ้าระวังโรคระบาด — หากไม่มีอาการไม่ต้องติ๊กเลือก',
		cancel: 'ยกเลิก',
		save: 'บันทึกข้อมูล',
		saving: 'กำลังบันทึก',
		invalidForm: 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน'
	}
};

const en: typeof th = {
	status: {
		title: 'Edit stay status',
		groupAria: 'Stay status',
		reason: 'Reason',
		reasonPlaceholder: 'Enter a reason, e.g. temporarily back home / moved out',
		cancel: 'Cancel',
		confirm: 'Confirm',
		saving: 'Saving...',
		checkedOutReasonRequired: 'A reason or note is required to check out',
		leaveReasonRequired: 'A reason is required for a temporary leave'
	},
	zone: {
		title: 'Change stay zone',
		cancel: 'Cancel',
		confirm: 'Confirm zone change',
		saving: 'Saving...'
	},
	emergency: {
		title: 'Edit emergency contact',
		close: 'Close',
		cancel: 'Cancel',
		save: 'Save contact',
		saving: 'Saving...',
		invalidForm: 'Please enter the contact details correctly and completely',
		incompleteContact: 'Please enter the name, a 10-digit phone number and the relationship'
	},
	assets: {
		title: 'Edit assets and pets',
		cancel: 'Cancel',
		save: 'Save',
		saving: 'Saving...'
	},
	address: {
		title: 'Edit family address',
		close: 'Close',
		municipalityZone: 'Municipal zone',
		municipalityZonePlaceholder: 'Enter the municipal zone...',
		community: 'Community',
		communityPlaceholder: 'Enter the community...',
		saveFailed: 'Could not save the data',
		cancel: 'Cancel',
		save: 'Save',
		saving: 'Saving...'
	},
	personal: {
		title: 'Edit personal information',
		subtitle: 'Identity details and main contact information',
		close: 'Close',
		photo: 'Photo',
		photoAlt: 'Sample evacuee photo',
		choosePhoto: 'Choose photo',
		removePhoto: 'Remove photo',
		cancel: 'Cancel',
		save: 'Save personal information',
		saving: 'Saving...',
		invalidForm: 'Please fill in the form correctly and completely',
		invalidPhone: 'Enter a 10-digit phone number or choose "no phone number"',
		invalidNationalId: 'The national ID number must have 13 digits',
		invalidAge: 'Age must be between 0 and 150 years'
	},
	household: {
		title: 'Edit household membership',
		close: 'Close',
		household: 'Household',
		selectedAffiliation: 'Selected household',
		noHousehold: 'Not in a household',
		searchPlaceholder: 'Search by phone number or household member name',
		scanQr: 'Scan QR',
		searching: 'Searching...',
		noJoinableMembers: 'No members found with a household that can be joined',
		hitHousehold: (label: string) => `Household: ${label}`,
		setAsHead: 'Set as head of household',
		cancel: 'Cancel',
		save: 'Save household membership',
		saving: 'Saving...',
		qrNotFound: 'No evacuee found for this QR code',
		noHouseholdFor: (name: string) => `${name} is not in a household yet`,
		cannotJoin: 'Cannot join this household (not ready or not at the shelter)',
		selectedHousehold: (label: string) => `Selected household: ${label}`,
		qrReadError: 'Error reading the QR code'
	},
	health: {
		title: 'Edit health information',
		closeAria: 'Close the health information dialog',
		close: 'Close',
		historyTitle: '1. Health history and care track',
		historyDesc:
			'Set the care track and record chronic conditions, regular medications, allergies and general symptoms',
		vulnerableTitle: '2. Vulnerable groups',
		vulnerableDesc: 'Select any that apply (optional)',
		specialNeedsTitle: '3. Special needs',
		specialNeedsDesc: 'Common tags, or add your own special needs (optional)',
		ewarTitle: '4. Epidemiological surveillance symptoms (EWAR)',
		ewarDesc: 'Outbreak surveillance symptom groups — leave unchecked if there are no symptoms',
		cancel: 'Cancel',
		save: 'Save',
		saving: 'Saving',
		invalidForm: 'Please fill in the form correctly and completely'
	}
};

export const EVACUEE_PROFILE_MODALS_I18N = { th, en };
