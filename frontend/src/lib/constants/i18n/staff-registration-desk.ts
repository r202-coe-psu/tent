/** Station 1 routes: registration desk, walk-in, report-in, and central-queue review. */
const th = {
	common: {
		leaveConfirm: 'มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?',
		backToQueue: 'กลับคิวทะเบียน'
	},
	desk: {
		pageTitle: 'ทะเบียนผู้ประสบภัย (Station 1) | SmartShelter',
		backToMenuAria: 'กลับหน้าเลือกเมนูหลัก',
		heading: 'ทะเบียนผู้ประสบภัย',
		subheading: 'Registration Desk — จุดรับรายงานตัวผู้จองล่วงหน้าและรับลงทะเบียนหน้างาน (Walk-in)',
		walkInCta: '+ ลงทะเบียน Walk-in',
		searchLabel: 'ค้นหาหรือสแกนก่อนลงทะเบียน (ตรวจซ้ำในศูนย์นี้และคิวกลาง)',
		searchHint: 'พิมพ์ชื่อ, เลขบัตร 13 หลัก, เบอร์โทร หรือใช้เครื่องสแกนบาร์โค้ด',
		scanTitle: 'สแกน Person QR',
		toastSearch: (raw: string) => `ค้นหา: ${raw}`,
		toastFound: (name: string) => `พบ: ${name}`,
		toastPoolFound: 'พบคิวลงทะเบียนล่วงหน้า (คิวกลาง)',
		toastScanFailed: 'ค้นหาจากรหัสที่สแกนไม่สำเร็จ',
		cameraError: 'ไม่สามารถเข้าถึงกล้องได้'
	},
	walkIn: {
		pageTitle: 'ลงทะเบียนครอบครัว | SmartShelter',
		duplicateCheckFailed: 'ตรวจสอบข้อมูลซ้ำไม่ได้ ลองบันทึกใหม่อีกครั้ง',
		matchedMember: (position: number, name: string) =>
			`สมาชิกคนที่ ${position}${name ? ` — ${name}` : ''}`,
		noShelterToast: 'ยังไม่ได้เลือกศูนย์พักพิง — เลือกศูนย์ก่อนลงทะเบียน',
		registered: (count: number) => `ลงทะเบียนครอบครัว ${count} คน สำเร็จ`,
		partialRollbackNote:
			'ยกเลิกข้อมูลที่บันทึกไปแล้วได้ไม่ครบ — กดบันทึกซ้ำได้โดยไม่ต้องแก้ข้อมูล (ระบบจะไม่สร้างซ้ำ) ถ้าแก้ข้อมูลแล้ว ให้ค้นหาชื่อในคิวทะเบียนก่อน',
		partialToast: 'ข้อมูลอาจถูกบันทึกไปบางส่วน — กดบันทึกซ้ำได้โดยไม่ต้องแก้ข้อมูล',
		heading: 'ลงทะเบียนครอบครัว',
		intro:
			'กรอกข้อมูลครอบครัวร่วมด้านบน แล้วเพิ่มสมาชิกทีละคนด้านล่าง — คนที่ 1 คือผู้ติดต่อหลักของครอบครัวที่ศูนย์จะประสานงานด้วย',
		noShelterAlert: 'ยังไม่ได้เลือกศูนย์พักพิง — เลือกศูนย์จากแถบด้านบนก่อนลงทะเบียน',
		saveInto: 'บันทึกเข้าศูนย์',
		possibleDuplicates: 'พบข้อมูลที่อาจซ้ำของ:'
	},
	reportIn: {
		pageTitle: (name: string | null) => (name ? `รายงานตัว · ${name}` : 'รายงานตัว'),
		toastSuccess: (count: number) => `รายงานตัวสำเร็จ ${count} คน`,
		failSummary: 'บันทึกการรายงานตัวไม่สำเร็จ',
		failToast: 'บันทึกการรายงานตัวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
		heading: 'รายงานตัวผู้ประสบภัย',
		introReadOnly: 'แสดงข้อมูลแบบอ่านอย่างเดียว — การแก้ไขทำได้ที่หน้าโปรไฟล์ผู้ประสบภัยเท่านั้น',
		introEdit:
			'ตรวจสอบข้อมูลครอบครัว เลือกสมาชิกที่เดินทางมารายงานตัวในรอบนี้ และสามารถเพิ่มสมาชิกใหม่ได้',
		loading: 'กำลังโหลดข้อมูลผู้ประสบภัยและครอบครัว...',
		notFoundTitle: 'ไม่พบผู้ประสบภัย',
		notFoundPrefix: 'รหัส',
		notFoundSuffix: 'ไม่มีในศูนย์นี้',
		alreadyTitle: 'ผู้ประสบภัยรายงานตัวแล้ว',
		alreadyBody: (status: string) =>
			`สถานะปัจจุบัน: ${status} — ข้อมูลด้านล่างแสดงแบบอ่านอย่างเดียว หากต้องการแก้ไข กรุณาไปที่หน้าโปรไฟล์ผู้ประสบภัย`,
		goToProfile: 'ไปที่หน้าโปรไฟล์'
	},
	unassigned: {
		pageTitle: 'ตรวจสอบก่อนรับเข้าศูนย์ | SmartShelter',
		petCapToast: 'สัตว์เลี้ยงเกินเพดานของครัวเรือน',
		petCapError: (total: number, cap: number, over: number, advice: string) =>
			`สัตว์เลี้ยงของครัวเรือนนี้จะรวมเป็น ${total} ตัว เกินเพดาน ${cap} ตัวต่อครัวเรือนอยู่ ${over} ตัว — ${advice}`,
		adviceReduceOrPool:
			'ลดสัตว์เลี้ยงที่กรอกเพิ่มในขั้นตอนที่ 3 หรือกลับไปเลือกจากคิวกลางให้น้อยลง',
		adviceReduceRetry: 'ลดสัตว์เลี้ยงที่กรอกเพิ่มในขั้นตอนที่ 3 แล้วกดยืนยันอีกครั้ง',
		adviceBackToQueue: 'กลับไปที่คิวทะเบียนแล้วเลือกสัตว์เลี้ยงให้น้อยลง',
		readHouseholdFailed:
			'อ่านข้อมูลครัวเรือนหลังรับเข้าศูนย์ไม่ได้ — กดยืนยันอีกครั้งเพื่อบันทึกการรายงานตัว',
		claimed: (count: number) => `รับเข้าศูนย์สำเร็จ ${count} คน`,
		confirmCapSummary: 'ยังยืนยันไม่ได้ — สัตว์เลี้ยงเกินเพดานของครัวเรือน',
		claimFailedSummary: 'รับเข้าศูนย์ไม่สำเร็จ',
		reportInFailedSummary: 'บันทึกการรายงานตัวไม่สำเร็จ',
		reportInFailedRollback:
			'รับเข้าศูนย์แล้ว — กดยืนยันอีกครั้งเพื่อบันทึกการรายงานตัว หรือไปที่หน้ารายงานตัวของผู้ประสบภัยแต่ละคนแทน',
		confirmFailedToast: 'ยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
		petsClaimed: (count: number) => `รับเข้าศูนย์ ${count} สัตว์สำเร็จ`,
		petsCapSummary: 'ยังรับเข้าศูนย์ไม่ได้ — สัตว์เลี้ยงเกินเพดานของครัวเรือน',
		claimFailedToast: 'รับเข้าศูนย์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
		undoClaimAll: 'เลือกเฉพาะสัตว์เลี้ยงที่ติ๊กมาตอนแรก',
		leftBehindClaimedTitle: (count: number) => `สัตว์เลี้ยง ${count} ตัวยังค้างอยู่ในคิวกลาง`,
		leftBehindTitle: (count: number) => `ยังมีสัตว์เลี้ยง ${count} ตัวที่ไม่ได้เลือก`,
		leftBehindClaimedBody:
			'รับเข้าศูนย์ไปแล้วโดยไม่มีสัตว์เลี้ยงด้านล่าง — กดยืนยันซ้ำจะไม่รับเข้าให้อีก ต้องกลับไปที่คิวทะเบียนแล้วรับเข้าแยกอีกครั้ง',
		leftBehindBody:
			'ถ้ารับเข้าศูนย์ตอนนี้ สัตว์เลี้ยงด้านล่างจะค้างอยู่ในคิวกลาง และจะไม่ปรากฏในข้อมูลครัวเรือนที่สถานี 1',
		addRemainingPets: 'เพิ่มสัตว์เลี้ยงที่เหลือเข้ารายการนี้',
		heading: 'ตรวจสอบก่อนรับเข้าศูนย์',
		intro:
			'ยังไม่มีการรับเข้าศูนย์ — ตรวจสอบข้อมูลด้านล่างแล้วกดยืนยัน จึงจะสร้าง Evacuee และรับเข้าศูนย์จริง',
		loading: 'กำลังโหลดข้อมูลจากคิวกลาง...',
		notFoundTitle: 'ไม่พบรายการนี้ในคิวกลาง',
		notFoundBody: 'รายการอาจถูกรับเข้าศูนย์ไปแล้ว หรือถูกยกเลิก — กลับไปค้นหาใหม่อีกครั้ง',
		staleTitle: 'สมาชิกที่เลือกไม่ว่างแล้ว',
		staleBody:
			'สมาชิกที่ติ๊กไว้ถูกรับเข้าศูนย์อื่นไปแล้วระหว่างที่เปิดหน้านี้ค้างไว้ — กลับไปค้นหาใหม่อีกครั้ง',
		petsToClaimTitle: 'สัตว์เลี้ยงที่จะรับเข้าศูนย์',
		householdAlreadyHere: (count: number) =>
			`ครัวเรือนนี้อยู่ในศูนย์แล้ว (${count} สัตว์เดิม) — รายการด้านล่างจะถูกเพิ่มเข้าไป`,
		confirming: 'กำลังรับเข้าศูนย์...',
		confirmClaim: 'ยืนยันรับเข้าศูนย์',
		petsAlongsideTitle: 'สัตว์เลี้ยงที่จะรับเข้าศูนย์พร้อมกัน'
	},
	scanner: {
		alreadyInForm: 'บัตรนี้อยู่ในฟอร์มแล้ว',
		dialogTitle: 'สมาชิกทุกคนมีข้อมูลแล้ว',
		dialogDescription: (name: string) => `จะนำข้อมูลจากบัตรของ ${name} ไปใส่ที่ไหน`,
		overwriteMember: (position: number) => `ทับคนที่ ${position}`,
		addAsNewMember: 'เพิ่มเป็นสมาชิกใหม่',
		cancel: 'ยกเลิก'
	}
};

const en: typeof th = {
	common: {
		leaveConfirm: 'You have unsaved changes. Leave this page?',
		backToQueue: 'Back to registration queue'
	},
	desk: {
		pageTitle: 'Evacuee Registry (Station 1) | SmartShelter',
		backToMenuAria: 'Back to the main menu',
		heading: 'Evacuee Registry',
		subheading:
			'Registration Desk — report-in for pre-registered evacuees and on-site walk-in registration',
		walkInCta: '+ Register walk-in',
		searchLabel: 'Search or scan before registering (checks this shelter and the central queue)',
		searchHint: 'Type a name, 13-digit ID, or phone number, or use a barcode scanner',
		scanTitle: 'Scan Person QR',
		toastSearch: (raw: string) => `Searching: ${raw}`,
		toastFound: (name: string) => `Found: ${name}`,
		toastPoolFound: 'Found a pre-registration in the central queue',
		toastScanFailed: 'Could not look up the scanned code',
		cameraError: 'Cannot access the camera'
	},
	walkIn: {
		pageTitle: 'Register Family | SmartShelter',
		duplicateCheckFailed: 'Could not check for duplicates. Please try saving again.',
		matchedMember: (position: number, name: string) =>
			`Member ${position}${name ? ` — ${name}` : ''}`,
		noShelterToast: 'No shelter selected — choose a shelter before registering',
		registered: (count: number) =>
			`Registered a family of ${count} ${count === 1 ? 'person' : 'people'}`,
		partialRollbackNote:
			'Some saved records could not be rolled back — you can save again without changing anything (nothing will be created twice). If you edited the data, search the name in the registration queue first.',
		partialToast: 'Some data may have been saved — you can save again without changing anything',
		heading: 'Register Family',
		intro:
			'Fill in the shared family details above, then add members one by one below — member 1 is the family’s primary contact whom the shelter will coordinate with',
		noShelterAlert: 'No shelter selected — choose a shelter from the top bar before registering',
		saveInto: 'Saving into shelter',
		possibleDuplicates: 'Possible duplicates of:'
	},
	reportIn: {
		pageTitle: (name: string | null) => (name ? `Report in · ${name}` : 'Report in'),
		toastSuccess: (count: number) => `Reported in ${count} ${count === 1 ? 'person' : 'people'}`,
		failSummary: 'Could not save the report-in',
		failToast: 'Could not save the report-in. Please try again.',
		heading: 'Evacuee Report-in',
		introReadOnly: 'Read-only view — edits can only be made on the evacuee profile page',
		introEdit:
			'Review the family details, select the members who came to report in this round, and add new members if needed',
		loading: 'Loading evacuee and family details...',
		notFoundTitle: 'Evacuee not found',
		notFoundPrefix: 'ID',
		notFoundSuffix: 'is not in this shelter',
		alreadyTitle: 'Evacuee has already reported in',
		alreadyBody: (status: string) =>
			`Current status: ${status} — the details below are read-only. To make changes, go to the evacuee profile page.`,
		goToProfile: 'Go to profile'
	},
	unassigned: {
		pageTitle: 'Review before admitting | SmartShelter',
		petCapToast: 'Pets exceed the household limit',
		petCapError: (total: number, cap: number, over: number, advice: string) =>
			`This household would have ${total} pets in total, ${over} over the limit of ${cap} per household — ${advice}`,
		adviceReduceOrPool:
			'reduce the extra pets entered in step 3, or go back and select fewer from the central queue',
		adviceReduceRetry: 'reduce the extra pets entered in step 3, then confirm again',
		adviceBackToQueue: 'go back to the registration queue and select fewer pets',
		readHouseholdFailed:
			'Could not read the household after admission — confirm again to save the report-in',
		claimed: (count: number) => `Admitted ${count} ${count === 1 ? 'person' : 'people'}`,
		confirmCapSummary: 'Cannot confirm yet — pets exceed the household limit',
		claimFailedSummary: 'Admission failed',
		reportInFailedSummary: 'Could not save the report-in',
		reportInFailedRollback:
			'Already admitted — confirm again to save the report-in, or go to each evacuee’s report-in page instead',
		confirmFailedToast: 'Confirmation failed. Please try again.',
		petsClaimed: (count: number) => `Admitted ${count} ${count === 1 ? 'pet' : 'pets'}`,
		petsCapSummary: 'Cannot admit yet — pets exceed the household limit',
		claimFailedToast: 'Admission failed. Please try again.',
		undoClaimAll: 'Select only the pets that were ticked originally',
		leftBehindClaimedTitle: (count: number) =>
			`${count} ${count === 1 ? 'pet is' : 'pets are'} still in the central queue`,
		leftBehindTitle: (count: number) =>
			`${count} ${count === 1 ? 'pet is' : 'pets are'} not selected`,
		leftBehindClaimedBody:
			'Admitted without the pets below — confirming again will not admit them. Go back to the registration queue and admit them separately.',
		leftBehindBody:
			'If you admit now, the pets below will stay in the central queue and will not appear in the household record at Station 1',
		addRemainingPets: 'Add the remaining pets to this admission',
		heading: 'Review before admitting',
		intro:
			'Nobody has been admitted yet — review the details below and confirm to create the Evacuee records and admit them to the shelter',
		loading: 'Loading details from the central queue...',
		notFoundTitle: 'Entry not found in the central queue',
		notFoundBody:
			'The entry may already have been admitted or cancelled — go back and search again',
		staleTitle: 'The selected members are no longer available',
		staleBody:
			'The ticked members were admitted elsewhere while this page was left open — go back and search again',
		petsToClaimTitle: 'Pets to admit',
		householdAlreadyHere: (count: number) =>
			`This household is already in the shelter (${count} existing ${count === 1 ? 'pet' : 'pets'}) — the pets below will be added`,
		confirming: 'Admitting...',
		confirmClaim: 'Confirm admission',
		petsAlongsideTitle: 'Pets to admit at the same time'
	},
	scanner: {
		alreadyInForm: 'This card is already in the form',
		dialogTitle: 'Every member already has data',
		dialogDescription: (name: string) => `Where should the data from ${name}'s card go?`,
		overwriteMember: (position: number) => `Overwrite member ${position}`,
		addAsNewMember: 'Add as a new member',
		cancel: 'Cancel'
	}
};

export const STAFF_REGISTRATION_DESK_I18N = { th, en };
