export const EVACUEE_FORM_I18N = {
	th: {
		steps: [
			{
				title: 'ตรวจสอบประวัติการลงทะเบียน',
				short: 'ตรวจสอบประวัติ',
				description: 'ค้นหาด้วยเลขบัตรประชาชน, เบอร์โทรศัพท์ หรือชื่อ-นามสกุล ก่อนลงทะเบียนใหม่'
			},
			{
				title: 'ส่วนประเมินอาการเจ็บป่วยและกลุ่มอาการเฝ้าระวัง (EWAR Symptoms)',
				short: 'ประเมินอาการ',
				description: 'โปรดสังเกตอาการหรือสอบถามผู้ประสบภัยก่อนเริ่มลงทะเบียน หากพบอาการให้แจ้งเตือน'
			},
			{
				title: 'ข้อมูลผู้ประสบภัย (Registration)',
				short: 'ข้อมูลผู้ประสบภัย',
				description: 'กรอกข้อมูลพื้นฐานและประเมินสถานะ'
			},
			{
				title: 'หน้าค้นหาครัวเรือน (Head of Household)',
				short: 'ข้อมูลครัวเรือน',
				description:
					'เลือกครัวเรือนเดิม หรือสร้างครัวเรือนใหม่ (ผู้ที่มาเพียงคนเดียวให้สร้างครัวเรือน 1 คน)'
			},
			{
				title: 'ทรัพย์สินและสัตว์เลี้ยง (Assets & Pets)',
				short: 'ทรัพย์สินและสัตว์เลี้ยง',
				description: 'บันทึกข้อมูลสัมภาระ ยานพาหนะ สัตว์เลี้ยง และสถานะบ้าน'
			},
			{
				title: 'จัดสรรพื้นที่ (Zoning)',
				short: 'จัดสรรพื้นที่',
				description: 'เลือกโซนพักพิง'
			}
		],
		stepOf: (step: number, total: number) => `ขั้น ${step} จาก ${total}`,
		progressAria: 'ความคืบหน้าการลงทะเบียน',
		zoneErrorTitle: 'จัดสรรพื้นที่ไม่สำเร็จ',
		closeAlert: 'ปิดการแจ้งเตือน',
		toastSuccessRegistration: 'ลงทะเบียนผู้ประสบภัยและครัวเรือนสำเร็จ',
		toastSuccessZoning: 'บันทึกข้อมูลและจัดสรรพื้นที่สำเร็จ',
		toastSaveFailed: 'บันทึกไม่สำเร็จ — ดูรายละเอียดในกล่องแจ้งเตือนด้านบน',
		toastZoneFailed: 'จัดสรรพื้นที่ไม่สำเร็จ — ดูรายละเอียดในกล่องแจ้งเตือนด้านบน',
		householdAlertTitle: 'ผู้ประสบภัยทุกคนต้องมีครัวเรือน',
		householdAlertDesc:
			'เลือกครัวเรือนเดิม หรือสร้างครัวเรือนใหม่ หากมาเพียงคนเดียวให้สร้างครัวเรือน 1 คน โดยผู้ลงทะเบียนจะเป็นหัวหน้าครัวเรือน',
		householdLoading: 'กำลังโหลดข้อมูลครัวเรือน...',
		householdLoadErrorTitle: 'โหลดข้อมูลครัวเรือนไม่สำเร็จ',
		householdLoadErrorDesc: 'ยังค้นหาครัวเรือนที่มีอยู่ไม่ได้ แต่ยังสามารถสร้างครัวเรือนใหม่ได้',
		retry: 'ลองใหม่',
		nextAssetsPets: 'ถัดไป (ข้อมูลสัตว์เลี้ยง/ยานพาหนะ)',
		back: 'ย้อนกลับ',
		toastSelectHouseholdFirst: 'กรุณาเลือกครัวเรือนเดิม หรือสร้างครัวเรือนใหม่ก่อนดำเนินการต่อ',
		errorMissingEvacueeData: 'ไม่พบข้อมูลผู้ประสบภัยที่กำลังลงทะเบียน',
		errorHouseholdNotFound: 'ไม่พบครัวเรือนในระบบ',
		errorMustSelectHousehold: 'ต้องเลือกหรือสร้างครัวเรือนก่อนลงทะเบียนผู้ประสบภัย',
		zoneErrorMissingEvacuee:
			'ไม่พบข้อมูลผู้ประสบภัยที่กำลังคัดแยก กรุณาย้อนกลับไปตรวจสอบขั้นตอนก่อนหน้า',
		zoneErrorNotFound:
			'ไม่พบข้อมูลผู้ประสบภัยในระบบ — ข้อมูลอาจยังไม่ถูกบันทึกครบ กรุณาย้อนกลับหรือลองใหม่อีกครั้ง',
		zoneErrorRetry:
			'จัดสรรพื้นที่ไม่สำเร็จ — ข้อมูลผู้ประสบภัยถูกบันทึกแล้ว กรุณาลองเลือกโซนอีกครั้ง ไม่ต้องลงทะเบียนใหม่'
	},
	en: {
		steps: [
			{
				title: 'Registration History Check',
				short: 'History Check',
				description: 'Search by ID number, phone, or full name before creating a new registration'
			},
			{
				title: 'Illness & Surveillance Symptoms Assessment (EWAR)',
				short: 'Symptoms',
				description:
					'Observe or ask evacuees about symptoms before registration. Alert if symptoms are present.'
			},
			{
				title: 'Evacuee Information (Registration)',
				short: 'Evacuee Info',
				description: 'Fill in basic information and assess status'
			},
			{
				title: 'Household Selection (Head of Household)',
				short: 'Household',
				description:
					'Select existing household or create a new one (single evacuees create a 1-person household)'
			},
			{
				title: 'Assets & Pets',
				short: 'Assets & Pets',
				description: 'Record luggage, vehicles, pets, and home status'
			},
			{
				title: 'Zoning Allocation',
				short: 'Zoning',
				description: 'Select shelter zone'
			}
		],
		stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
		progressAria: 'Registration progress',
		zoneErrorTitle: 'Zoning Allocation Failed',
		closeAlert: 'Close Alert',
		toastSuccessRegistration: 'Evacuee and household registered successfully',
		toastSuccessZoning: 'Information saved and zone allocated successfully',
		toastSaveFailed: 'Save failed — see details in the alert box above',
		toastZoneFailed: 'Zoning allocation failed — see details in the alert box above',
		householdAlertTitle: 'All evacuees must belong to a household',
		householdAlertDesc:
			'Select an existing household or create a new one. If arriving alone, create a 1-person household with the evacuee as the head of household.',
		householdLoading: 'Loading household data...',
		householdLoadErrorTitle: 'Failed to load household data',
		householdLoadErrorDesc:
			'Could not search existing households, but you can still create a new household.',
		retry: 'Retry',
		nextAssetsPets: 'Next (Assets & Pets)',
		back: 'Back',
		toastSelectHouseholdFirst:
			'Please select an existing household or create a new one before continuing',
		errorMissingEvacueeData: 'Evacuee registration data not found',
		errorHouseholdNotFound: 'Household not found in system',
		errorMustSelectHousehold: 'Must select or create a household before registering evacuee',
		zoneErrorMissingEvacuee:
			'Evacuee data not found for zoning. Please go back to check previous steps.',
		zoneErrorNotFound:
			'Evacuee not found in system — data may not be fully saved. Please go back or try again.',
		zoneErrorRetry:
			'Zoning allocation failed — evacuee information is already saved. Please try selecting a zone again without re-registering.'
	}
} as const;

export type EvacueeFormI18n = typeof EVACUEE_FORM_I18N;
