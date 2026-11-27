/**
 * Shared staff chrome copy: onsite hub + station band, shelter navbar, account menu, connection
 * banner, generic search-select defaults, and the /portal home page.
 */
const th = {
	onsite: {
		back: 'กลับหน้าหลัก',
		title: 'ระบบส่วนหน้า ณ ศูนย์พักพิง',
		subtitle: 'เลือกงานที่ต้องการทำ',
		stationNames: {
			1: 'จุดลงทะเบียน',
			2: 'จุดคัดกรองสุขภาพ',
			3: 'จุดจัดโซน'
		},
		tiles: {
			registration: { title: 'จุดลงทะเบียน', caption: 'Registration Desk' },
			screening: { title: 'จุดคัดกรองสุขภาพ', caption: 'Health Screening Desk' },
			zoning: { title: 'จุดจัดโซน', caption: 'Zoning Desk' },
			distribution: {
				title: 'จุดแจกจ่าย',
				caption: 'Distribution Desk'
			},
			searchEdit: { title: 'ค้นหาและแก้ไขข้อมูล', caption: 'Search & Update' },
			checkInOut: { title: 'สแกนเข้า-ออกศูนย์', caption: 'Check-in / Out' },
			volunteer: { title: 'เช็คอินจิตอาสาเข้างาน', caption: 'Check-in Volunteer' }
		}
	},
	navbar: {
		selectShelter: 'เลือกศูนย์พักพิง',
		loading: 'กำลังโหลด...',
		loadError: 'เกิดข้อผิดพลาดในการโหลดข้อมูล'
	},
	accountMenu: {
		account: 'บัญชีผู้ใช้',
		user: 'ผู้ใช้',
		myAccount: 'บัญชีของฉัน',
		logout: 'ออกจากระบบ',
		loggedOut: 'Logged out successfully'
	},
	connection: {
		disconnected: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบเครือข่ายแล้วลองอีกครั้ง',
		retry: 'ลองเชื่อมต่ออีกครั้ง'
	},
	searchSelect: {
		placeholder: 'เลือก...',
		searchPlaceholder: 'ค้นหา...',
		emptyText: 'ไม่พบข้อมูล',
		loadingText: 'กำลังโหลด...',
		moreResults: (n: number) => `พิมพ์เพิ่มเพื่อค้นหาอีก ${n} รายการ`
	},
	portalPage: {
		contextAria: 'บริบทการปฏิบัติงาน',
		operator: 'ผู้ปฏิบัติงาน',
		greeting: (name: string) => `สวัสดี, ${name}`,
		systemAdminRole: 'ผู้ดูแลระบบส่วนกลาง',
		generalUserRole: 'ผู้ใช้งานทั่วไป',
		myCard: 'ดูบัตรของฉัน',
		activeShelterAria: 'ศูนย์พักพิงที่ปฏิบัติงาน',
		selectShelter: 'เลือกศูนย์พักพิง',
		loadingShelters: 'กำลังโหลดศูนย์...',
		noShelter: 'ไม่มีสังกัดศูนย์',
		systemStatusAria: 'สถานะระบบ',
		connected: 'เชื่อมต่อแล้ว',
		connecting: 'กำลังเชื่อมต่อ...',
		offline: 'ออฟไลน์'
	}
};

const en: typeof th = {
	onsite: {
		back: 'Back to home',
		title: 'Onsite Shelter Operations',
		subtitle: 'Choose the task you want to do',
		stationNames: {
			1: 'Registration desk',
			2: 'Health screening desk',
			3: 'Zoning desk'
		},
		tiles: {
			registration: { title: 'Registration desk', caption: 'Registration Desk' },
			screening: { title: 'Health screening desk', caption: 'Health Screening Desk' },
			zoning: { title: 'Zoning desk', caption: 'Zoning Desk' },
			distribution: {
				title: 'Distribution desk',
				caption: 'Distribution Desk'
			},
			searchEdit: { title: 'Search and Edit Records', caption: 'Search & Update' },
			checkInOut: { title: 'Scan Entry / Exit', caption: 'Check-in / Out' },
			volunteer: { title: 'Volunteer Shift Check-in', caption: 'Check-in Volunteer' }
		}
	},
	navbar: {
		selectShelter: 'Select shelter',
		loading: 'Loading...',
		loadError: 'Failed to load data'
	},
	accountMenu: {
		account: 'User account',
		user: 'User',
		myAccount: 'My account',
		logout: 'Log out',
		loggedOut: 'Logged out successfully'
	},
	connection: {
		disconnected: 'Cannot reach the server — check your network and try again',
		retry: 'Try reconnecting'
	},
	searchSelect: {
		placeholder: 'Select...',
		searchPlaceholder: 'Search...',
		emptyText: 'No results found',
		loadingText: 'Loading...',
		moreResults: (n: number) => `Type to search ${n} more ${n === 1 ? 'item' : 'items'}`
	},
	portalPage: {
		contextAria: 'Operating context',
		operator: 'Staff member',
		greeting: (name: string) => `Hello, ${name}`,
		systemAdminRole: 'System Administrator',
		generalUserRole: 'General user',
		myCard: 'View my card',
		activeShelterAria: 'Active shelter',
		selectShelter: 'Select shelter',
		loadingShelters: 'Loading shelters...',
		noShelter: 'No shelter assigned',
		systemStatusAria: 'System status',
		connected: 'Connected',
		connecting: 'Connecting...',
		offline: 'Offline'
	}
};

export const STAFF_CHROME_I18N = { th, en };
