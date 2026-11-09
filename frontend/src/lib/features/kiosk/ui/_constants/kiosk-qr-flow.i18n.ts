/**
 * Strings of the QR check-in flow: scan, member pick, consent, phone, done. Printed label
 * content is not here on purpose: printouts stay Thai.
 */
/** "1 member" / "3 members". */
const memberCount = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`;

const th = {
	qrScan: {
		pageTitle: 'สแกน QR — SmartShelter Kiosk',
		heading: 'สแกน QR ลงทะเบียน',
		invalidQr: 'QR นี้ใช้รายงานตัวไม่ได้',
		cameraOpenFailed: 'เปิดกล้องไม่ได้',
		readerStillWorks: 'ยังใช้เครื่องอ่าน QR ได้',
		retry: 'ลองอีกครั้ง',
		preparing: 'กำลังเตรียม…',
		readerHint: 'สแกน QR ที่เครื่องสแกนด้านล่างขวาของจอ',
		cameraHint: 'วาง QR ในกรอบ',
		readerLabel: 'เครื่องสแกน QR',
		cameraAria: 'ภาพจากกล้องสแกน QR'
	},
	registerPhone: {
		heading: 'เบอร์โทรศัพท์ที่ติดต่อได้',
		hint: 'เจ้าหน้าที่จะใช้ติดต่อคุณ ถ้าไม่มีเบอร์ กด「ไม่มีเบอร์」ได้เลย',
		displayLabel: 'เบอร์โทรศัพท์ที่กรอก',
		placeholder: 'เบอร์โทรศัพท์',
		confirm: 'ยืนยันเบอร์นี้',
		skip: 'ไม่มีเบอร์'
	},
	registerConsent: {
		tag: 'ก่อนเริ่มลงทะเบียน',
		headingCard: 'ยินยอมให้อ่านข้อมูลจากบัตรประชาชน',
		headingThaid: 'ยินยอมให้ใช้ข้อมูลจาก ThaiD',
		bodyThaid:
			'ระบบจะใช้ชื่อและนามสกุล เลขบัตรประชาชน เพศ วันเกิด และที่อยู่ที่ยืนยันผ่าน ThaiD (ไม่มีรูปถ่าย) และเบอร์โทรศัพท์ที่ท่านกรอก (ถ้ามี) เพื่อสร้างรายการผู้ประสบภัยของศูนย์นี้ และส่งข้อมูลให้เจ้าหน้าที่ตรวจสอบก่อนยืนยันการเข้าพัก',
		bodyCard:
			'ระบบจะอ่านชื่อและนามสกุล เลขบัตรประชาชน เพศ วันเกิด ที่อยู่ และรูปถ่ายจากชิปบัตร และเบอร์โทรศัพท์ที่ท่านกรอก (ถ้ามี) เพื่อสร้างรายการผู้ประสบภัยของศูนย์นี้ และส่งข้อมูลให้เจ้าหน้าที่ตรวจสอบก่อนยืนยันการเข้าพัก',
		pending:
			'ข้อมูลจะถูกเก็บในรายการที่รอยืนยัน และเจ้าหน้าที่จะตรวจสอบข้อมูลเมื่อท่านไปพบเจ้าหน้าที่',
		insertCard:
			'กรุณาเสียบบัตรของผู้ที่ต้องการลงทะเบียน เมื่อหน้าจอแจ้งว่าลงทะเบียนสำเร็จแล้วจึงนำบัตรออก',
		cancel: 'ยกเลิก'
	},
	picker: {
		heading: 'พบหลายครัวเรือนที่ใช้เบอร์นี้',
		subheading: 'เลือกครัวเรือนของท่าน',
		noName: 'ไม่ระบุชื่อ',
		allReported: 'รายงานตัวครบแล้ว',
		pendingSummary: (members: number, pending: number) =>
			`สมาชิก ${members} คน · รอรายงานตัว ${pending} คน`,
		reprintNone: (members: number) => `สมาชิก ${members} คน · ยังไม่มี QR ให้พิมพ์`,
		reprintSome: (members: number, printable: number) =>
			`สมาชิก ${members} คน · พิมพ์ QR ได้ ${printable} คน`,
		reprintState: (printable: number) => `พิมพ์ QR ได้ ${printable} คน`,
		pendingState: (pending: number) => `รอรายงานตัว ${pending} คน`,
		accessibleName: (contact: string, members: number, state: string) =>
			`${contact}, สมาชิก ${members} คน, ${state}`
	},
	checkIn: {
		pageTitle: 'ตรวจสอบและรายงานตัว — SmartShelter Kiosk',
		stepThaid: 'สแกนด้วย ThaiD',
		stepVerify: 'ยืนยันตัวตน',
		backToPhone: 'กลับไปกรอกเบอร์',
		noName: 'ไม่ระบุชื่อ',
		errors: {
			centerMismatch: 'ข้อมูลศูนย์ของเครื่องสแกนไม่ตรงกัน กรุณาติดต่อผู้ดูแลเครื่อง',
			lookupFailed: 'ค้นหาข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง',
			partialFailure:
				'บางรายการยังรายงานตัวไม่สำเร็จ ตรวจผลด้านล่างและลองเฉพาะรายการที่เหลืออีกครั้ง',
			checkInFailed: 'บันทึกการรายงานตัวไม่สำเร็จ',
			qrPrepareFailed: 'สร้าง QR สำหรับพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
			labelDataFailed: 'โหลดข้อมูลสำหรับพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
			labelRenderFailed: 'สร้าง label สำหรับพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
			printHint: (message: string) => `${message} ใช้ปุ่มพิมพ์อีกครั้งได้โดยไม่บันทึก check-in ซ้ำ`
		},
		status: {
			pre_registered: 'ลงทะเบียนล่วงหน้า',
			kiosk_registered: 'ลงทะเบียนที่ตู้ (รอยืนยัน)',
			arriving: 'รายงานตัวแล้ว · รอคัดกรอง',
			room_confirmed: 'ยืนยันที่พักแล้ว',
			temporary_leave: 'ออกไปชั่วคราว',
			active: 'เข้าพักแล้ว',
			cancelled: 'ยกเลิก',
			unknown: 'ไม่พร้อมรายงานตัว'
		},
		title: {
			notPreRegistered: 'ยังไม่ได้ลงทะเบียนล่วงหน้า',
			alreadyKioskRegistered: 'ลงทะเบียนที่ตู้แล้ว',
			lookupFailed: 'ค้นหาไม่สำเร็จ',
			results: 'ผลรายงานตัว',
			chooseHousehold: 'เลือกครัวเรือน',
			verifyIdentity: 'ตรวจสอบตัวตน',
			chooseMembers: 'เลือกสมาชิก',
			waitingForCard: 'รอเสียบบัตร',
			searching: 'กำลังค้นหา'
		},
		sub: {
			insertCard: 'เสียบบัตรเพื่อค้นหา',
			chooseArrived: 'เลือกผู้ที่มาถึง',
			chooseHousehold: 'เลือกครัวเรือนของท่าน',
			reprintFound: 'พบผลรายงานตัวเดิม ไม่มีการบันทึกซ้ำ · เลือกคนที่จะพิมพ์ QR Code',
			alreadyFound: 'พบผลรายงานตัวเดิม ไม่มีการบันทึกซ้ำ',
			reviewThenPrint: 'ตรวจผล แล้วพิมพ์ QR Code'
		},
		waitingForCard: 'รอเสียบบัตร',
		searchingData: 'กำลังค้นหาข้อมูล…',
		walkInClosed: {
			title: 'ไม่พบข้อมูลลงทะเบียนล่วงหน้า',
			body: 'ไม่สามารถลงทะเบียนเพิ่มที่ตู้นี้ได้ กรุณาติดต่อเจ้าหน้าที่'
		},
		alreadyKiosk: {
			title: 'ไปพบเจ้าหน้าที่เพื่อยืนยันข้อมูล',
			bodyThaid: 'ข้อมูลนี้ลงทะเบียนที่ตู้ไว้แล้ว กรุณาติดต่อเจ้าหน้าที่',
			bodyCard: 'บัตรนี้ลงทะเบียนที่ตู้ไว้แล้ว ไม่ต้องลงทะเบียนซ้ำ',
			home: 'กลับหน้าแรก'
		},
		members: {
			heading: 'สมาชิก',
			shelter: (code: string) => `ศูนย์ ${code}`,
			selectAll: 'เลือกทั้งหมด',
			clearAll: 'ยกเลิกทั้งหมด',
			nameMasked: 'ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว',
			phoneMatch: 'เบอร์ตรง',
			registrant: 'ผู้ลงทะเบียน',
			ageUnknown: 'ไม่ระบุอายุ',
			age: (years: number) => `${years} ปี`,
			selectedNote: (count: number) => `เลือก ${count} คน · รายงานตัวแล้วเลือกซ้ำไม่ได้`,
			cancel: 'ยกเลิก',
			saving: 'กำลังบันทึก…',
			confirm: (count: number) => `ยืนยัน · ${count} คน`,
			centerMismatch: 'ศูนย์บนหน้าจอไม่ตรงกับศูนย์ที่ผูกกับเครื่อง จึงยังยืนยันไม่ได้'
		},
		results: {
			partial: 'รายงานตัวได้บางส่วน',
			reported: 'รายงานตัวแล้ว',
			saved: 'บันทึกผลรายงานตัวแล้ว',
			none: 'ไม่มีสมาชิกที่รายงานตัวสำเร็จ',
			summaryPartial: (reported: number, remaining: number, shelter: string) =>
				`รายงานตัวแล้ว ${reported} คน · ยังเหลือ ${remaining} คนที่ต้องตรวจผลหรือทำรายการซ้ำ · ศูนย์ ${shelter}`,
			summaryAll: (reported: number, total: number, shelter: string) =>
				`รายงานตัวแล้ว ${reported} จาก ${total} คน · ศูนย์ ${shelter}`,
			retryRemaining: (count: number) => `ลองรายการที่เหลืออีกครั้ง · ${count} คน`,
			saving: 'กำลังบันทึก…',
			preparingQr: 'กำลังเตรียม QR…',
			printQr: 'พิมพ์ QR Code',
			printQrCount: (count: number) => `พิมพ์ QR Code · ${count} คน`,
			done: 'เสร็จสิ้น',
			rowCheckedIn: 'รายงานตัวสำเร็จ · รอคัดกรอง',
			rowReprintable: 'รายงานตัวแล้ว · พิมพ์ QR ใหม่ได้ (QR ใบเก่าจะใช้ไม่ได้)',
			rowFailed: 'ไม่สามารถรายงานตัวได้ กรุณาให้เจ้าหน้าที่ตรวจสอบ',
			rowQrIssueFailed: 'ออก QR ไม่สำเร็จ · ยังไม่ได้พิมพ์ กรุณาลองใหม่หรือติดต่อเจ้าหน้าที่',
			qrIssueFailed: (count: number) =>
				`ออก QR ไม่สำเร็จ ${count} คน (ยังไม่ได้พิมพ์) กรุณาลองใหม่หรือติดต่อเจ้าหน้าที่`,
			retryQrIssue: 'ลองออก QR ใหม่'
		},
		qrNoPersonalData: 'QR ไม่มีข้อมูลส่วนบุคคล'
	}
};

const en: typeof th = {
	qrScan: {
		pageTitle: 'Scan QR — SmartShelter Kiosk',
		heading: 'Scan your registration QR',
		invalidQr: 'This QR cannot be used to check in',
		cameraOpenFailed: 'Cannot open the camera',
		readerStillWorks: 'You can still use the QR reader',
		retry: 'Try again',
		preparing: 'Getting ready…',
		readerHint: 'Scan the QR at the scanner at the bottom right of the screen',
		cameraHint: 'Place the QR in the frame',
		readerLabel: 'QR scanner',
		cameraAria: 'Camera view for scanning QR'
	},
	registerPhone: {
		heading: 'Contact phone number',
		hint: 'Staff will use it to reach you. No phone? Tap "No phone".',
		displayLabel: 'Phone number entered',
		placeholder: 'Phone number',
		confirm: 'Confirm this number',
		skip: 'No phone'
	},
	registerConsent: {
		tag: 'Before you register',
		headingCard: 'Consent to read data from your ID card',
		headingThaid: 'Consent to use your ThaiD data',
		bodyThaid:
			'The system will use the first and last name, ID number, sex, date of birth and address verified through ThaiD (no photo), and the phone number you enter (if any), to create an evacuee record for this shelter and send it to staff for review before your stay is confirmed.',
		bodyCard:
			'The system will read the first and last name, ID number, sex, date of birth, address and photo from the card chip, and the phone number you enter (if any), to create an evacuee record for this shelter and send it to staff for review before your stay is confirmed.',
		pending: 'Your data is kept as a pending record, and staff will review it when you meet them.',
		insertCard:
			'Please insert the card of the person to register. Take the card out only after the screen says registration is complete.',
		cancel: 'Cancel'
	},
	picker: {
		heading: 'Several households use this number',
		subheading: 'Choose your household',
		noName: 'Name not given',
		allReported: 'All checked in',
		pendingSummary: (members: number, pending: number) =>
			`${memberCount(members)} · ${pending} waiting to check in`,
		reprintNone: (members: number) => `${memberCount(members)} · no QR to print yet`,
		reprintSome: (members: number, printable: number) =>
			`${memberCount(members)} · ${printable} can print QR`,
		reprintState: (printable: number) => `${printable} can print QR`,
		pendingState: (pending: number) => `${pending} waiting to check in`,
		accessibleName: (contact: string, members: number, state: string) =>
			`${contact}, ${memberCount(members)}, ${state}`
	},
	checkIn: {
		pageTitle: 'Check-in — SmartShelter Kiosk',
		stepThaid: 'Scan ThaiD',
		stepVerify: 'Verify identity',
		backToPhone: 'Back to enter phone',
		noName: 'Name not given',
		errors: {
			centerMismatch:
				'The shelter on this kiosk does not match the record. Please contact the kiosk administrator.',
			lookupFailed: 'Could not look up your record. Please try again.',
			partialFailure:
				'Some people could not be checked in yet. Check the results below and retry only the remaining ones.',
			checkInFailed: 'Could not save the check-in',
			qrPrepareFailed: 'Could not prepare the QR for printing. Please try again.',
			labelDataFailed: 'Could not load the data to print. Please try again.',
			labelRenderFailed: 'Could not create the label to print. Please try again.',
			printHint: (message: string) =>
				`${message} You can press print again without saving the check-in again.`
		},
		status: {
			pre_registered: 'Pre-registered',
			kiosk_registered: 'Registered at kiosk (awaiting confirmation)',
			arriving: 'Checked in · awaiting screening',
			room_confirmed: 'Room confirmed',
			temporary_leave: 'Temporarily away',
			active: 'Staying at the shelter',
			cancelled: 'Cancelled',
			unknown: 'Not ready to check in'
		},
		title: {
			notPreRegistered: 'Not pre-registered',
			alreadyKioskRegistered: 'Already registered at the kiosk',
			lookupFailed: 'Lookup failed',
			results: 'Check-in results',
			chooseHousehold: 'Choose household',
			verifyIdentity: 'Verify identity',
			chooseMembers: 'Choose members',
			waitingForCard: 'Waiting for card',
			searching: 'Searching'
		},
		sub: {
			insertCard: 'Insert your card to search',
			chooseArrived: 'Select who has arrived',
			chooseHousehold: 'Choose your household',
			reprintFound:
				'Existing check-in found, nothing is saved again · choose who to print a QR Code for',
			alreadyFound: 'Existing check-in found, nothing is saved again',
			reviewThenPrint: 'Check the results, then print your QR Code'
		},
		waitingForCard: 'Waiting for card',
		searchingData: 'Searching…',
		walkInClosed: {
			title: 'No pre-registration found',
			body: 'This kiosk cannot register new people. Please contact staff.'
		},
		alreadyKiosk: {
			title: 'Please see staff to confirm your details',
			bodyThaid: 'These details are already registered at the kiosk. Please contact staff.',
			bodyCard: 'This card is already registered at the kiosk. No need to register again.',
			home: 'Back to home'
		},
		members: {
			heading: 'Members',
			shelter: (code: string) => `Shelter ${code}`,
			selectAll: 'Select all',
			clearAll: 'Clear all',
			nameMasked: 'Names are partly hidden for privacy',
			phoneMatch: 'Phone match',
			registrant: 'Registrant',
			ageUnknown: 'Age not given',
			age: (years: number) => `${years} yrs`,
			selectedNote: (count: number) =>
				`${count} selected · people already checked in cannot be selected again`,
			cancel: 'Cancel',
			saving: 'Saving…',
			confirm: (count: number) => `Confirm · ${count} ${count === 1 ? 'person' : 'people'}`,
			centerMismatch:
				"The shelter on screen does not match this kiosk's shelter, so it cannot be confirmed yet"
		},
		results: {
			partial: 'Partly checked in',
			reported: 'Checked in',
			saved: 'Check-in saved',
			none: 'No one could be checked in',
			summaryPartial: (reported: number, remaining: number, shelter: string) =>
				`${reported} checked in · ${remaining} still to check or retry · Shelter ${shelter}`,
			summaryAll: (reported: number, total: number, shelter: string) =>
				`${reported} of ${total} checked in · Shelter ${shelter}`,
			retryRemaining: (count: number) => `Retry the remaining · ${count}`,
			saving: 'Saving…',
			preparingQr: 'Preparing QR…',
			printQr: 'Print QR Code',
			printQrCount: (count: number) => `Print QR Code · ${count}`,
			done: 'Done',
			rowCheckedIn: 'Checked in successfully · awaiting screening',
			rowReprintable: 'Already checked in · a new QR can be printed (the old QR will stop working)',
			rowFailed: 'Could not check in. Please ask staff to check.',
			rowQrIssueFailed: 'Could not issue a QR · not printed. Please try again or contact staff.',
			qrIssueFailed: (count: number) =>
				`Could not issue a QR for ${count} ${count === 1 ? 'person' : 'people'} (not printed). Please try again or contact staff.`,
			retryQrIssue: 'Try issuing the QR again'
		},
		qrNoPersonalData: 'The QR holds no personal data'
	}
};

export const KIOSK_QR_FLOW_I18N = { th, en };
