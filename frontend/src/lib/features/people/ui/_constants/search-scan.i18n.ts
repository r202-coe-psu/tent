const th = {
	scan: {
		back: 'กลับ',
		title: 'สแกนเข้า-ออกศูนย์ (Check-in / Out)',
		subtitle: 'สแกนรหัสเพื่อจัดการสถานะผู้พำนัก',
		searchByName: 'ค้นหาด้วยชื่อ/เลขบัตร',
		cameraOff: 'กล้องสแกนเนอร์ปิดอยู่',
		cameraOffHint: 'สามารถค้นหาด้วยชื่อหรือพิมพ์รหัสแทนได้',
		cameraError: 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง',
		instructionsTitle: 'สแกนรหัสเพื่อจัดการสถานะ',
		instructionsBody:
			'ใช้เครื่องสแกนบาร์โค้ดสแกนที่บัตรผู้ประสบภัย หรือพิมพ์รหัสลงในช่องด้านล่าง ระบบจะพาไปยังหน้าจัดการสถานะทันที',
		codePlaceholder: 'กรอกรหัส หรือ สแกน QR...',
		submit: 'ตกลง',
		noStatus: 'ไม่มีข้อมูลสถานะ',
		familyTitle: 'จัดการเช็คอิน/เช็คเอาท์พร้อมกับครอบครัว',
		selectAll: 'เลือกทั้งหมด',
		scannedMember: 'คนที่สแกน',
		memberNeedsIntake: 'ยังไม่ผ่านจุดคัดกรอง/จัดโซน — ส่งไปสถานี 2–3',
		profile: 'โปรไฟล์',
		checkOut: 'เช็คเอาท์',
		checkIn: 'เช็คอิน',
		needsIntake: 'ยังไม่ผ่านจุดคัดกรอง/จัดโซน — ส่งไปสถานี 1–3 ก่อนเช็คอิน',
		cannotChange: 'ไม่สามารถเปลี่ยนสถานะนี้ได้',
		recheckHint: 'โปรดตรวจสอบข้อมูลรหัสบัตรประชาชน หรือ QR code ของผู้ประสบภัยอีกครั้ง',
		zoneDialogTitle: 'เลือกโซนสำหรับเช็คอิน',
		zoneDialogDescription: 'ผู้ประสบภัยยังไม่มีโซนเดิม — เลือกโซนที่จะเช็คอินเข้า',
		zoneSelectAria: 'โซนสำหรับเช็คอิน',
		pickZone: 'เลือกโซน',
		zoneCodeLabel: 'รหัสโซน',
		zoneCodePlaceholder: 'เช่น Z1',
		cancel: 'ยกเลิก',
		confirmCheckIn: 'ยืนยันเช็คอิน',
		checkoutDialogTitle: 'เหตุผลการเช็คเอาท์',
		checkoutDialogDescription: 'ระบุเหตุผลหรือหมายเหตุ (บังคับ) เช่น ออกไปธุระนอกพื้นที่',
		checkoutReasonLabel: 'เหตุผลการเช็คเอาท์',
		confirmCheckOut: 'ยืนยันเช็คเอาท์',
		toast: {
			notFoundMessage: (code: string, shelter: string) =>
				`ไม่พบข้อมูลผู้ประสบภัยจากรหัส/ชื่อ "${code}" ในศูนย์ ${shelter}`,
			notFound: (shelter: string) =>
				`ไม่พบรหัสนี้ในศูนย์ ${shelter} — โปรดตรวจสอบศูนย์ที่เลือกด้านบน`,
			unassignedMessage: 'พบคิวลงทะเบียนล่วงหน้า (คิวกลาง) — รับเข้าศูนย์ก่อนเช็คอิน/เอาท์',
			unassigned: 'พบคิวลงทะเบียนล่วงหน้า (คิวกลาง)',
			foundMessage: 'พบข้อมูลผู้ประสบภัย',
			found: (name: string) => `พบข้อมูล ${name}`,
			errorMessage: (detail: string) => `เกิดข้อผิดพลาด: ${detail}`,
			operationFailed: 'เกิดข้อผิดพลาดในการดำเนินการ',
			zoneRequired: 'การเช็คอินต้องระบุโซน',
			checkInSuccess: (n: number) => `เช็คอินสำเร็จ ${n} คน`,
			checkInPartial: (ok: number, failed: number) =>
				`เช็คอินสำเร็จ ${ok} คน, ล้มเหลว ${failed} คน`,
			checkInFailed: 'เช็คอินไม่สำเร็จ',
			checkOutSuccess: (n: number) => `เช็คเอาท์สำเร็จ ${n} คน`,
			checkOutPartial: (ok: number, failed: number) =>
				`เช็คเอาท์สำเร็จ ${ok} คน, ล้มเหลว ${failed} คน`,
			checkOutFailed: 'เช็คเอาท์ไม่สำเร็จ',
			checkoutReasonRequired: 'การเช็คเอาท์ต้องระบุเหตุผลหรือหมายเหตุ'
		}
	},
	scanSearchModal: {
		title: 'ค้นหาผู้พักพิงเพื่อเช็คอิน / เช็คเอาท์',
		placeholder: 'พิมพ์ชื่อ นามสกุล หรือหมายเลขโทรศัพท์...',
		searching: 'กำลังสืบค้น...',
		noMatch: 'ไม่พบรายชื่อที่ตรงกับคำค้นหา',
		prompt: 'พิมพ์ข้อมูลเพื่อสืบค้นประวัติ',
		idAndPhone: (id: string, phone: string) => `เลขบัตร: ${id} • โทร: ${phone}`,
		notSpecified: 'ไม่ระบุ',
		select: 'เลือก',
		statusShort: {
			pre_registered: 'รอเช็คอิน',
			kiosk_registered: 'ที่ตู้',
			arriving: 'รอจัดโซน',
			active: 'เช็คอิน',
			room_confirmed: 'ยืนยันถึงโซน',
			temporary_leave: 'ออกชั่วคราว',
			transferred: 'ย้ายศูนย์',
			checked_out: 'เช็คเอาท์',
			deceased: 'เสียชีวิต',
			cancelled: 'ยกเลิก'
		}
	},
	searchEdit: {
		documentTitle: 'ค้นหาและแก้ไขข้อมูล | SmartShelter Thailand',
		backAria: 'กลับหน้าเลือกเมนูหลัก',
		heading: 'ค้นหาและแก้ไขข้อมูลผู้พักพิง',
		subtitle: 'Search & Update — ค้นหาด้วยชื่อ เลขบัตร เบอร์โทร หรือสแกน QR',
		placeholder: 'ระบุเลขบัตรประชาชน / เบอร์โทรศัพท์ / ชื่อ-นามสกุล...',
		search: 'ค้นหาข้อมูล',
		scanQr: 'สแกน QR Code ตั๋ว'
	},
	qrSearchModal: {
		title: 'สแกน QR Code ตั๋วผู้พักพิง (Digital Pass Scanner)',
		cameraError: 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง',
		manualLabel: 'หรือระบุรหัสด้วยเครื่องสแกนบาร์โค้ด / พิมพ์ด้วยมือ:',
		placeholder: 'สแกนหรือพิมพ์เลขประจำตัว / รหัสตั๋ว...',
		submit: 'ตกลง',
		cancel: 'ยกเลิก',
		toast: {
			notFound: (code: string, shelter: string) =>
				`ไม่พบข้อมูลผู้พักพิงจากรหัส "${code}" ในศูนย์ ${shelter}`,
			unassigned: 'พบคิวลงทะเบียนล่วงหน้า (คิวกลาง)',
			scanned: (name: string) => `สแกนสำเร็จ: พบข้อมูล ${name}`,
			searchFailed: 'เกิดข้อผิดพลาดในการค้นหา'
		}
	},
	searchResults: {
		documentTitle: 'ผลการค้นหา | SmartShelter Thailand',
		back: 'กลับ',
		heading: 'ผลการค้นหาผู้พักพิง',
		subtitle: 'Search Results',
		searching: 'กำลังค้นหาข้อมูล...',
		foundTitle: (count: number) => `พบข้อมูลผู้พักพิงที่ตรงกัน (${count} รายการ)`,
		notFoundTitle: 'ไม่พบข้อมูลผู้พักพิงที่ตรงกัน',
		queryLabel: 'คำค้นหา:',
		newSearch: 'ค้นหาใหม่',
		idLine: (id: string) => `ID: ${id}`,
		zoneLine: (zone: string) => `Zone ${zone}`,
		viewAndEdit: 'ดูข้อมูลและแก้ไข',
		notFoundBody: 'ไม่พบข้อมูลผู้พักพิงที่ตรงกับคำค้นหานี้ กรุณาตรวจสอบคำค้นหาอีกครั้ง'
	}
};

const en: typeof th = {
	scan: {
		back: 'Back',
		title: 'Scan shelter check-in / check-out',
		subtitle: "Scan a code to manage the resident's status",
		searchByName: 'Search by name / ID number',
		cameraOff: 'The scanner camera is off',
		cameraOffHint: 'You can search by name or type the code instead',
		cameraError: 'Cannot access the camera. Please check the camera permission.',
		instructionsTitle: 'Scan a code to manage status',
		instructionsBody:
			"Scan the evacuee's card with a barcode scanner, or type the code in the box below. The system takes you straight to the status page.",
		codePlaceholder: 'Enter a code or scan a QR...',
		submit: 'OK',
		noStatus: 'No status information',
		familyTitle: 'Check in / check out together with the family',
		selectAll: 'Select all',
		scannedMember: 'Scanned',
		memberNeedsIntake: 'Has not passed screening / zoning yet. Send to station 2-3',
		profile: 'Profile',
		checkOut: 'Check out',
		checkIn: 'Check in',
		needsIntake: 'Has not passed screening / zoning yet. Send to station 1-3 before check-in',
		cannotChange: 'This status cannot be changed',
		recheckHint: "Please check the evacuee's ID number or QR code again",
		zoneDialogTitle: 'Choose a zone for check-in',
		zoneDialogDescription: 'This evacuee has no previous zone. Choose the zone to check in to',
		zoneSelectAria: 'Zone for check-in',
		pickZone: 'Choose a zone',
		zoneCodeLabel: 'Zone code',
		zoneCodePlaceholder: 'e.g. Z1',
		cancel: 'Cancel',
		confirmCheckIn: 'Confirm check-in',
		checkoutDialogTitle: 'Check-out reason',
		checkoutDialogDescription: 'Enter a reason or note (required), e.g. leaving for an errand',
		checkoutReasonLabel: 'Check-out reason',
		confirmCheckOut: 'Confirm check-out',
		toast: {
			notFoundMessage: (code: string, shelter: string) =>
				`No evacuee found for the code / name "${code}" in shelter ${shelter}`,
			notFound: (shelter: string) =>
				`This code was not found in shelter ${shelter}. Check the selected shelter above`,
			unassignedMessage:
				'Found a pre-registration in the central queue. Admit them to the shelter before check-in / check-out',
			unassigned: 'Found a pre-registration (central queue)',
			foundMessage: 'Evacuee found',
			found: (name: string) => `Found ${name}`,
			errorMessage: (detail: string) => `Something went wrong: ${detail}`,
			operationFailed: 'Something went wrong with the operation',
			zoneRequired: 'A zone is required to check in',
			checkInSuccess: (n: number) => `Checked in ${n} ${n === 1 ? 'person' : 'people'}`,
			checkInPartial: (ok: number, failed: number) => `Checked in ${ok}, ${failed} failed`,
			checkInFailed: 'Check-in failed',
			checkOutSuccess: (n: number) => `Checked out ${n} ${n === 1 ? 'person' : 'people'}`,
			checkOutPartial: (ok: number, failed: number) => `Checked out ${ok}, ${failed} failed`,
			checkOutFailed: 'Check-out failed',
			checkoutReasonRequired: 'A check-out reason is required'
		}
	},
	scanSearchModal: {
		title: 'Search residents to check in / check out',
		placeholder: 'Type a name, surname or phone number...',
		searching: 'Searching...',
		noMatch: 'No names match the search',
		prompt: 'Type to search the records',
		idAndPhone: (id: string, phone: string) => `ID number: ${id} • Phone: ${phone}`,
		notSpecified: 'Not specified',
		select: 'Select',
		statusShort: {
			pre_registered: 'Awaiting check-in',
			kiosk_registered: 'At kiosk',
			arriving: 'Awaiting zone',
			active: 'Checked in',
			room_confirmed: 'Zone confirmed',
			temporary_leave: 'On leave',
			transferred: 'Transferred',
			checked_out: 'Checked out',
			deceased: 'Deceased',
			cancelled: 'Cancelled'
		}
	},
	searchEdit: {
		documentTitle: 'Search and edit records | SmartShelter Thailand',
		backAria: 'Back to the main menu',
		heading: 'Search and edit evacuee records',
		subtitle: 'Search & Update — search by name, ID number, phone number or scan a QR code',
		placeholder: 'Enter ID number / phone number / full name...',
		search: 'Search records',
		scanQr: 'Scan ticket QR code'
	},
	qrSearchModal: {
		title: 'Scan ticket QR code (Digital Pass Scanner)',
		cameraError: 'Cannot access the camera. Please check the camera permission.',
		manualLabel: 'Or enter the code with a barcode scanner / type it in:',
		placeholder: 'Scan or type the ID number / ticket code...',
		submit: 'OK',
		cancel: 'Cancel',
		toast: {
			notFound: (code: string, shelter: string) =>
				`No evacuee found for the code "${code}" in shelter ${shelter}`,
			unassigned: 'Found a pre-registration (central queue)',
			scanned: (name: string) => `Scan successful: found ${name}`,
			searchFailed: 'Something went wrong with the search'
		}
	},
	searchResults: {
		documentTitle: 'Search results | SmartShelter Thailand',
		back: 'Back',
		heading: 'Evacuee search results',
		subtitle: 'Search Results',
		searching: 'Searching...',
		foundTitle: (count: number) =>
			`Found matching evacuees (${count} ${count === 1 ? 'result' : 'results'})`,
		notFoundTitle: 'No matching evacuees found',
		queryLabel: 'Search term:',
		newSearch: 'New search',
		idLine: (id: string) => `ID: ${id}`,
		zoneLine: (zone: string) => `Zone ${zone}`,
		viewAndEdit: 'View and edit',
		notFoundBody: 'No evacuee matches this search term. Please check it and try again'
	}
};

export const SEARCH_SCAN_I18N = { th, en };
