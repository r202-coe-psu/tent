export type Language = {
	code: string;
	name: string;
	isDefault?: boolean;
};

export const SUPPORTED_LANGUAGES: Language[] = [
	{ code: 'th', name: 'ไทย', isDefault: true },
	{ code: 'en', name: 'English' }
];

export const PUBLIC_NAVBAR_I18N = {
	th: {
		appTitle: 'Smart Shelter',
		appSubtitle: 'Public & RFL Portal',
		home: 'หน้าแรก',
		shelters: 'ตรวจสอบศูนย์พักพิง',
		search: 'สืบค้นญาติ',
		donate: 'บริจาค',
		donateAndBook: 'บริจาคและจองคิว',
		trackDonation: 'ตรวจสอบสถานะ',
		trackDonationLong: 'ตรวจสอบสถานะบริจาค',
		backoffice: 'ระบบหลังบ้าน'
	},
	en: {
		appTitle: 'Smart Shelter',
		appSubtitle: 'Public & RFL Portal',
		home: 'Home',
		shelters: 'Check Shelters',
		search: 'Find Relatives',
		donate: 'Donate',
		donateAndBook: 'Donate & Queue',
		trackDonation: 'Track Status',
		trackDonationLong: 'Track Donation Status',
		backoffice: 'Backoffice'
	}
} as const;

export const PUBLIC_HOME_I18N = {
	th: {
		pageTitle: 'Smart Shelter — Public & RFL Portal',
		sysError: 'ระบบขัดข้อง',
		sysErrorDesc: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาลองใหม่ภายหลัง',
		menuSectionTitle: 'เมนูช่องทางบริการความช่วยเหลือและตรวจสอบสิทธิ์',
		menuSectionDesc:
			'ดำเนินการติดต่อ ลงทะเบียน หรือประสานขอโอนย้ายเพื่อรับรองความช่วยเหลือที่รวดเร็ว',
		regTitle: 'ลงทะเบียนผู้ประสบภัย',
		regBadge: 'ด่วนที่สุด',
		regDesc:
			'ท่านสามารถยื่นขอลงทะเบียนเข้าพัก สแกนเข้าออก หรือจองสิทธิ์ล่วงหน้าเพื่อจัดสรรเต็นท์ส่วนตัว ยา และเครื่องนุ่งห่ม',
		regBtn: 'ลงทะเบียน (เร็วๆนี้)',
		donateTitle: 'สำหรับผู้ใจบุญ/บริจาค',
		donateBadge: 'Wishlist',
		donateDesc:
			'ร่วมประสานงานมอบอาหารปรุงสุก วัตถุดิบ น้ำดื่ม หรือสมทบกองทุน EOC ข้อมูลจัดซื้อโปร่งใส ตรวจสอบได้ทันที',
		donateBtn1: 'แจ้งบริจาคสิ่งของล่วงหน้า',
		donateBtn2: 'ดูบัญชีรับบริจาค / บอร์ดขอของ (เร็วๆนี้)',
		volTitle: 'สำหรับทีมอาสาสมัคร',
		volBadge: 'ร่วมแรงกาย',
		volDesc:
			'ร่วมลงทะเบียนจองกะงานฝ่ายสวัสดิการ แจกจ่าย ขนย้าย แพทย์สนาม หรือสนับสนุนเจ้าหน้าที่ ณ พื้นที่อุทกภัยชายแดนใต้',
		volBtn: 'สมัคร / จองกะช่วยเหลือ (เร็วๆนี้)',
		searchTitle: 'สืบค้นผู้ประสบภัย',
		searchBadge: 'PDPA Shield',
		searchDesc:
			'เช็ครายชื่อผู้ประสบภัย ปลอดภัยในพิกัดศูนย์ควบคุม ตรึงระบบเก็บรวบรวมหลักฐานและส่งต่ออย่างเป็นความลับขั้นสูงสุด',
		searchBtn: 'ค้นหารายบุคคลด่วนที่สุด',
		faqTitle: 'ศูนย์รวมความช่วยเหลือ (EOC Help Center & FAQ)',
		faqDesc:
			'คำถามที่พบบ่อยระดับศูนย์รวมคำชักซ้อมจากประชาชน ดึงพิกัดข้อมูลจัดตั้งเรียลไทม์จากระบบตั้งค่า FAQ ของฝ่ายบริหารศูนย์ (EOC Dashboard Setup)',
		faqEmpty: 'ยังไม่มีข้อมูลคำถามที่พบบ่อย',
		faqLink: 'ตรวจสอบพิกัดแผนที่แต่ละศูนย์และบ้านพี่เลี้ยง',
		contactStandby: 'OPERATIONS ON STANDBY 24/7',
		contactTitle: 'ประสานการกู้ชีพฉุกเฉินและหน่วยเคลื่อนที่เร็ว',
		contactDesc:
			'หากติดค้างอยู่ในตึกจมน้ำ เจ็บครรภ์คลอด สัตว์มีพิษกัด หรือต้องการรถย้ายระดับสูงพิกัดตำบล ประสานงานโดยอัตโนมัติ',
		contact1669Label: 'สายด่วนกู้ชีพแพทย์ฉุกเฉิน',
		contact1784Label: 'ศูนย์เตือนภัย ปภ. พายุคุกคาม',
		call: 'โทร'
	},
	en: {
		pageTitle: 'Smart Shelter — Public & RFL Portal',
		sysError: 'System Error',
		sysErrorDesc: 'Cannot connect to database. Please try again later.',
		menuSectionTitle: 'Service & Eligibility Checking Menu',
		menuSectionDesc: 'Contact, register, or request transfer for rapid assistance.',
		regTitle: 'Victim Registration',
		regBadge: 'Urgent',
		regDesc:
			'You can request to stay, scan in/out, or reserve a personal tent, medicine, and clothing in advance.',
		regBtn: 'Register',
		donateTitle: 'For Donors',
		donateBadge: 'Wishlist',
		donateDesc:
			'Coordinate donations of cooked food, ingredients, drinking water, or contribute to EOC funds. Transparent and verifiable.',
		donateBtn1: 'Pre-declare Donation',
		donateBtn2: 'View Donation Accounts (Coming soon)',
		volTitle: 'For Volunteers',
		volBadge: 'Join Us',
		volDesc:
			'Register for shifts in welfare, distribution, logistics, field medical, or support staff in flood areas.',
		volBtn: 'Apply / Book Shift (Coming soon)',
		searchTitle: 'Find Victims',
		searchBadge: 'PDPA Shield',
		searchDesc:
			'Check victim lists safely within control centers, maintaining strict confidentiality.',
		searchBtn: 'Urgent Person Search',
		faqTitle: 'Help Center (EOC Help Center & FAQ)',
		faqDesc: 'Frequently asked questions pulled in real-time from the central EOC Dashboard Setup.',
		faqEmpty: 'No frequently asked questions available.',
		faqLink: 'Check map coordinates for each shelter and host house',
		contactStandby: 'OPERATIONS ON STANDBY 24/7',
		contactTitle: 'Coordinate Emergency Rescue',
		contactDesc:
			'If trapped in a flooded building, in labor, bitten by venomous animals, or needing a high-clearance vehicle, auto-coordinate here.',
		contact1669Label: 'Emergency Medical Hotline',
		contact1784Label: 'DDPM Storm Warning Center',
		call: 'Call'
	}
} as const;

export const PUBLIC_HERO_I18N = {
	th: {
		defaultTitle: 'ระบบค้นหาผู้ประสบภัยในศูนย์อพยพ',
		defaultDesc:
			'เชื่อมต่อ อำนวยความสะดวก และรายงานความช่วยเหลือสาธารณะเพื่อความโปร่งใสแบบตามเวลาจริง (Real-Time Transparency) สามารถสืบหาญาติ ติดตามผู้ประสบภัย หรือร่วมแจกจ่ายเสบียงผ่านเครือข่ายของเรา',
		defaultBadge: 'LIVE DISASTER COORDINATION LINK',
		searchPlaceholder: 'สืบค้นด้วย ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน',
		searchBtn: 'ค้นหาญาติตอนนี้',
		staleWarning: 'ข้อมูลอาจไม่เป็นปัจจุบัน',
		currentStatus: 'สถานการณ์ปัจจุบัน ณ ขณะนี้',
		lastUpdated: 'อัปเดตล่าสุด',
		sheltersReady: 'ศูนย์พักพิงพร้อมให้บริการ',
		sheltersUnit: 'แห่ง',
		victimsSafe: 'ผู้ประสบภัยปลอดภัย',
		victimsUnit: 'คน'
	},
	en: {
		defaultTitle: 'Evacuation Center Victim Search System',
		defaultDesc:
			'Connect, facilitate, and report public assistance for real-time transparency. Find relatives, track victims, or distribute supplies through our network.',
		defaultBadge: 'LIVE DISASTER COORDINATION LINK',
		searchPlaceholder: 'Search by Name, Surname, Phone, or ID Card',
		searchBtn: 'Find Relatives Now',
		staleWarning: 'Data may not be up-to-date',
		currentStatus: 'Current Situation',
		lastUpdated: 'Last Updated',
		sheltersReady: 'Available Shelters',
		sheltersUnit: 'Locations',
		victimsSafe: 'Safe Victims',
		victimsUnit: 'People'
	}
} as const;

export const PUBLIC_EMERGENCY_I18N = {
	th: {
		emergency: 'ฉุกเฉิน (Emergency)',
		warning: 'แจ้งเตือน (Warning)',
		info: 'ทั่วไป (Info)',
		urgent: 'ประกาศด่วน'
	},
	en: {
		emergency: 'Emergency',
		warning: 'Warning',
		info: 'Info',
		urgent: 'Urgent Announcement'
	}
} as const;

export const PUBLIC_SHELTERS_I18N = {
	th: {
		pageTitle: 'ตรวจสอบสถานะศูนย์พักพิง - Smart Shelter',
		heroTitle: 'ตรวจสอบสถานะศูนย์พักพิง',
		heroDesc:
			'ข้อมูลศูนย์พักพิงจากระบบสาธารณะ — ชื่อ พิกัด สถานะ และความจุ เพื่อประกอบการตัดสินใจเคลื่อนย้ายและขอรับความช่วยเหลือ',
		heroBadge: 'Public Shelter Dashboard',
		totalShelters: 'ศูนย์พักพิงทั้งหมด',
		openShelters: 'ศูนย์พักพิงที่เปิดใช้งาน',
		locationsUnit: 'แห่ง',
		listTitle: 'รายชื่อศูนย์พักพิง',
		noShelters: 'ไม่พบข้อมูลศูนย์พักพิง',
		tryChangeFilter: 'ลองเปลี่ยนเงื่อนไขการค้นหาอีกครั้ง',
		statusOpen: 'เปิดใช้งาน',
		statusFull: 'เต็มความจุ',
		statusPrepare: 'เตรียมพร้อม',
		statusClosed: 'ปิดทำการ'
	},
	en: {
		pageTitle: 'Check Shelter Status - Smart Shelter',
		heroTitle: 'Check Shelter Status',
		heroDesc:
			'Public shelter information — name, coordinates, status, and capacity to assist in relocation and aid requests.',
		heroBadge: 'Public Shelter Dashboard',
		totalShelters: 'Total Shelters',
		openShelters: 'Open Shelters',
		locationsUnit: 'Locations',
		listTitle: 'Shelter List',
		noShelters: 'No shelter data found',
		tryChangeFilter: 'Please try changing the search criteria',
		statusOpen: 'Open',
		statusFull: 'Full',
		statusPrepare: 'Preparing',
		statusClosed: 'Closed'
	}
} as const;

export const PUBLIC_SEARCH_I18N = {
	th: {
		pageTitle: 'ระบบสืบค้นญาติและครอบครัว - Smart Shelter',
		heroTitle: 'ระบบสืบค้นญาติและครอบครัว',
		heroDesc:
			'สืบค้นและตรวจสอบสถานะความปลอดภัยของบุคคลในครอบครัว เพื่อบรรเทาความเครียดโดยไม่ต้องออกเดินทางตามหา ด้วยระบบคุ้มครองข้อมูลส่วนบุคคล (PDPA)',
		heroBadge: 'Restoring Family Links',
		searchBoxTitle: 'กรอกข้อมูลเพื่อค้นหา',
		searchBoxDesc: 'รองรับการค้นหาด้วย ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน',
		searchPlaceholder: 'พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน...',
		searchingBtn: 'กำลังค้นหา...',
		searchBtn: 'ค้นหา',
		errorMinChars: 'กรุณากรอกข้อมูลอย่างน้อย 3 ตัวอักษร',
		errorConnect: 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้',
		foundResults: 'พบข้อมูลทั้งหมด',
		itemsCount: 'รายการ',
		unnamed: 'ไม่ระบุชื่อ',
		withFamily: 'มากับครอบครัว',
		alone: 'มาเดี่ยว',
		genderMale: 'ชาย',
		genderFemale: 'หญิง',
		genderOther: 'อื่นๆ',
		statusInShelter: 'ปลอดภัย (อยู่ในศูนย์แล้ว)',
		statusMoved: 'ย้ายศูนย์พักพิงแล้ว',
		statusLeft: 'ออกจากศูนย์แล้ว (กลับบ้าน/ส่งต่อ)',
		stayingAt: 'อาศัยอยู่ที่ศูนย์พักพิง',
		origin: 'ภูมิลำเนาเดิม',
		checkinTime: 'เวลาลงทะเบียนเข้าพัก',
		notSpecifiedTime: 'ไม่ระบุเวลา',
		careZone: 'สถานะความดูแล (โซน)',
		familyInfo: 'ข้อมูลสมาชิกในครอบครัว',
		people: 'คน',
		clickToView: 'คลิกเพื่อดู',
		hide: 'ซ่อน',
		safeInShelter: 'ปลอดภัยอยู่ในศูนย์',
		noResultsTitle: 'ไม่พบรายชื่อ',
		noResultsDesc: 'ไม่พบข้อมูลที่ตรงกับการค้นหา กรุณาตรวจสอบความถูกต้องอีกครั้ง',
		startSearchTitle: 'เริ่มการค้นหา',
		startSearchDesc: 'พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน เพื่อทำการสืบค้นข้อมูล',
		prevBtn: 'ก่อนหน้า',
		nextBtn: 'ถัดไป',
		page: 'หน้า',
		of: 'จาก'
	},
	en: {
		pageTitle: 'Family & Relatives Search - Smart Shelter',
		heroTitle: 'Family Search System',
		heroDesc:
			'Search and check the safety status of family members to relieve stress without traveling, protected by PDPA privacy laws.',
		heroBadge: 'Restoring Family Links',
		searchBoxTitle: 'Enter information to search',
		searchBoxDesc: 'Supports search by Name, Surname, Phone, or ID Card',
		searchPlaceholder: 'Type name, surname, phone, or ID...',
		searchingBtn: 'Searching...',
		searchBtn: 'Search',
		errorMinChars: 'Please enter at least 3 characters',
		errorConnect: 'Cannot connect to the server',
		foundResults: 'Found',
		itemsCount: 'results',
		unnamed: 'Unknown Name',
		withFamily: 'With Family',
		alone: 'Alone',
		genderMale: 'Male',
		genderFemale: 'Female',
		genderOther: 'Other',
		statusInShelter: 'Safe (In Shelter)',
		statusMoved: 'Moved Shelter',
		statusLeft: 'Left Shelter (Home/Referred)',
		stayingAt: 'Staying at',
		origin: 'Origin Address',
		checkinTime: 'Check-in Time',
		notSpecifiedTime: 'Time not specified',
		careZone: 'Care Zone',
		familyInfo: 'Family Members Info',
		people: 'people',
		clickToView: 'Click to view',
		hide: 'Hide',
		safeInShelter: 'Safe in Shelter',
		noResultsTitle: 'No Results Found',
		noResultsDesc: 'No data matching the search criteria. Please check again.',
		startSearchTitle: 'Start Searching',
		startSearchDesc: 'Type name, surname, phone, or ID card to search for information.',
		prevBtn: 'Previous',
		nextBtn: 'Next',
		page: 'Page',
		of: 'of'
	}
} as const;

export const PUBLIC_SHELTER_CARD_I18N = {
	th: {
		districtPrefix: 'อ.',
		provincePrefix: 'จ.',
		distance: 'ระยะห่าง:',
		km: 'กม.',
		maxCapacity: 'รองรับได้สูงสุด',
		people: 'คน',
		vulnerableGroups: 'กลุ่มเปราะบางที่รองรับ',
		petPolicy: 'นโยบายสัตว์เลี้ยง',
		viewDetails: 'ดูรายละเอียด',
		navigate: 'นำทาง',
		generalVulnerable: 'กลุ่มเปราะบางทั่วไป',
		quarantine: 'ผู้ป่วยแยกกักโรค',
		wheelchair: 'ผู้ใช้วีลแชร์',
		noSpecificZone: 'ไม่มีโซนเฉพาะ',
		notAllowed: 'ไม่อนุญาต',
		allowed: 'อนุญาต (มีโซนสัตว์เลี้ยง)',
		smallGeneral: 'สัตว์เล็กทั่วไป',
		largeDog: 'สุนัขพันธุ์ใหญ่',
		livestock: 'ปศุสัตว์',
		conditionalAllowed: 'อนุญาตแบบมีเงื่อนไข'
	},
	en: {
		districtPrefix: 'Dist.',
		provincePrefix: 'Prov.',
		distance: 'Distance:',
		km: 'km',
		maxCapacity: 'Max Capacity',
		people: 'people',
		vulnerableGroups: 'Supported Vulnerable Groups',
		petPolicy: 'Pet Policy',
		viewDetails: 'View Details',
		navigate: 'Navigate',
		generalVulnerable: 'General Vulnerable',
		quarantine: 'Quarantine',
		wheelchair: 'Wheelchair User',
		noSpecificZone: 'No specific zone',
		notAllowed: 'Not allowed',
		allowed: 'Allowed (Pet zone available)',
		smallGeneral: 'Small general pets',
		largeDog: 'Large dogs',
		livestock: 'Livestock',
		conditionalAllowed: 'Allowed with conditions'
	}
} as const;

export const PUBLIC_FILTER_PANEL_I18N = {
	th: {
		title: 'ค้นหาและตัวกรอง',
		searchLabel: 'ค้นหา',
		searchPlaceholder: 'ชื่อศูนย์...',
		provinceLabel: 'จังหวัด',
		provincePlaceholder: 'จังหวัด (ทั้งหมด)',
		districtLabel: 'อำเภอ/เขต',
		districtPlaceholder: 'อำเภอ (ทั้งหมด)',
		subdistrictLabel: 'ตำบล/แขวง',
		subdistrictPlaceholder: 'ตำบล (ทั้งหมด)',
		typeLabel: 'ประเภทศูนย์พักพิง',
		typePlaceholder: 'ประเภท (ทั้งหมด)',
		radiusLabel: 'รัศมีจากตำแหน่งของคุณ (GPS)',
		km: 'กม.',
		geoInsecure: 'ต้องเปิดผ่าน HTTPS หรือ localhost จึงใช้รัศมีจากตำแหน่งได้',
		geoPolicy: 'เบราว์เซอร์บล็อกการเข้าถึงตำแหน่งในหน้านี้',
		geoDenied: 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — แสดงศูนย์ทั้งหมด',
		geoUnsupported: 'ใช้ตำแหน่งไม่ได้ — แสดงศูนย์ทั้งหมด',
		geoLocating: 'กำลังขอตำแหน่ง...',
		hideFullTitle: 'แสดงเฉพาะศูนย์ที่ยังไม่เต็ม',
		hideFullDesc: 'ซ่อนศูนย์พักพิงที่ความจุเต็มแล้ว',
		advancedFilters: 'ตัวกรองขั้นสูง (Advanced Filters)',
		cat1: '1. การดูแลกลุ่มเปราะบาง',
		vulBed: 'มีเตียงสำหรับผู้ป่วยติดเตียง',
		vulWheelchair: 'รองรับผู้พิการ / วีลแชร์เข้าถึงได้',
		vulInfant: 'มีพื้นที่สำหรับเด็กอ่อน / หญิงตั้งครรภ์',
		vulElderly: 'รองรับผู้สูงอายุ',
		vulIsolation: 'มีห้องแยกกักโรค (Isolation Zone)',
		cat2: '2. นโยบายสัตว์เลี้ยง',
		petGen: '🐶 อนุญาตสัตว์เลี้ยงทั่วไป (สุนัขเล็ก, แมว)',
		petLarge: '🦮 อนุญาตสุนัขขนาดใหญ่',
		petLive: '🐄 มีพื้นที่รองรับปศุสัตว์ (วัว, ควาย, แพะ)',
		cat3: '3. พื้นที่จอดยานพาหนะ',
		parkCar: '🚗 มีที่จอดรถยนต์ / กระบะ (และยังไม่เต็ม)',
		parkMotor: '🏍️ มีที่จอดรถจักรยานยนต์',
		parkBoat: '🛥️ มีจุดจอดเรือ / เรืออพยพ',
		cat4: '4. สาธารณูปโภคและความปลอดภัย',
		utilWifi: '📶 มีสัญญาณ Wi-Fi ของศูนย์ให้บริการ',
		facKitchen: '🍲 มีโรงครัวกลาง (อาหาร)',
		facWomen: '🛡️ มีพื้นที่ปลอดภัยสำหรับเด็กและสตรี',
		clearBtn: 'ล้างค่า',
		submitBtn: 'ค้นหาและกรองข้อมูล'
	},
	en: {
		title: 'Search & Filters',
		searchLabel: 'Search',
		searchPlaceholder: 'Shelter name...',
		provinceLabel: 'Province',
		provincePlaceholder: 'Province (All)',
		districtLabel: 'District',
		districtPlaceholder: 'District (All)',
		subdistrictLabel: 'Sub-district',
		subdistrictPlaceholder: 'Sub-district (All)',
		typeLabel: 'Shelter Type',
		typePlaceholder: 'Type (All)',
		radiusLabel: 'Radius from your location (GPS)',
		km: 'km',
		geoInsecure: 'Must use HTTPS or localhost for location-based search',
		geoPolicy: 'Browser blocked location access on this page',
		geoDenied: 'Location permission denied — Showing all shelters',
		geoUnsupported: 'Location unavailable — Showing all shelters',
		geoLocating: 'Locating...',
		hideFullTitle: 'Show only available shelters',
		hideFullDesc: 'Hide shelters that are at full capacity',
		advancedFilters: 'Advanced Filters',
		cat1: '1. Vulnerable Group Care',
		vulBed: 'Bed-bound patient beds available',
		vulWheelchair: 'Disabled / Wheelchair accessible',
		vulInfant: 'Space for infants / pregnant women',
		vulElderly: 'Supports elderly',
		vulIsolation: 'Isolation Zone available',
		cat2: '2. Pet Policy',
		petGen: '🐶 Small pets allowed (small dogs, cats)',
		petLarge: '🦮 Large dogs allowed',
		petLive: '🐄 Livestock area available (cows, buffalos, goats)',
		cat3: '3. Parking Area',
		parkCar: '🚗 Car / Pickup parking (not full)',
		parkMotor: '🏍️ Motorcycle parking',
		parkBoat: '🛥️ Boat docking point',
		cat4: '4. Utilities and Security',
		utilWifi: '📶 Wi-Fi available',
		facKitchen: '🍲 Central kitchen (food)',
		facWomen: '🛡️ Safe space for women and children',
		clearBtn: 'Clear',
		submitBtn: 'Search and Filter'
	}
} as const;
