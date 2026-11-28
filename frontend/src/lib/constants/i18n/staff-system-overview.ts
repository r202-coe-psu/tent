/**
 * System overview page (`/system-management/overview`) — plain-language copy (#1503).
 *
 * One term per concept across the page:
 * - "ลงทะเบียนล่วงหน้า" (not Pre-reg), "เลือกศูนย์" (not ผูกศูนย์), "ตอนนี้ / คาดการณ์" for the
 *   two occupancy figures, "ช่วงวันที่เข้า–ออกศูนย์" for the movement range.
 */
const th = {
	pageTitle: 'ภาพรวมระบบ',
	pageDescription: 'สรุปสถานะศูนย์ การลงทะเบียนล่วงหน้า และการเคลื่อนย้ายทั่วระบบ',
	errorTitle: 'เกิดข้อผิดพลาด',
	errorBody: 'ไม่สามารถโหลดข้อมูลภาพรวมได้ กรุณาลองใหม่อีกครั้ง',
	all: 'ทั้งหมด',

	// ---- phase strip
	preRegTitle: 'ลงทะเบียนล่วงหน้า (รอเข้าศูนย์)',
	preRegDescription: 'จำนวนคนที่ลงทะเบียนไว้แล้วแต่ยังไม่เข้าพัก',
	preRegNoShelter: 'ยังไม่ได้เลือกศูนย์',
	preRegAtShelter: 'ลงทะเบียนล่วงหน้าที่ระบุศูนย์แล้ว',
	inShelterTitle: 'อยู่ในศูนย์',
	inShelterDescription: 'ปัจจุบัน / คาดการณ์ (ไม่รวมศูนย์ที่ปิด ยกเลิก และศูนย์ภายนอก)',
	current: 'ปัจจุบัน',
	forecast: 'คาดการณ์',
	avgCapacityUse: 'อัตราการใช้ความจุเฉลี่ย',
	hintCurrent: 'จำนวนผู้ที่มีสถานะเข้าพักแล้ว ยืนยันห้องพักแล้ว หรือออกจากศูนย์ชั่วคราว',
	hintForecast:
		'จำนวนผู้ที่อยู่ในศูนย์และผู้ที่ลงทะเบียนหรือรายงานตัวแล้ว รวมถึงผู้ที่รอคัดกรองและจัดที่พัก',
	hintCapacityUse:
		'สัดส่วนความจุของทุกศูนย์รวมกัน โดยคิดจากจำนวนผู้พักทั้งหมดเทียบกับความจุรวม ไม่ใช่การเฉลี่ยเปอร์เซ็นต์ของแต่ละศูนย์',
	avgCapacityValue: (now: string, forecast: string) => `ตอนนี้ ${now} · คาดการณ์ ${forecast}`,

	// ---- shelter counts per kind
	siteUnit: 'ศูนย์',
	externalSites: 'ศูนย์ภายนอก',
	closedOrCancelledSites: 'ศูนย์ที่ปิด/ยกเลิก',

	// ---- sites table
	sitesTitle: 'ศูนย์พักพิงทั้งหมด',
	sitesDescription: 'เรียงตามสัดส่วนผู้ที่คาดว่าจะเข้าพักต่อความจุ (มาก → น้อย)',
	movementRange: 'ช่วงวันที่เข้า–ออกศูนย์',
	sitesEmpty: 'ไม่พบศูนย์ที่ตรงเงื่อนไข',
	colName: 'ชื่อ',
	colKind: 'ประเภท',
	colStatus: 'สถานะ',
	colPresent: 'ปัจจุบัน',
	colForecast: 'คาดการณ์',
	colPresentPct: '% ความจุ (ตอนนี้)',
	colForecastPct: '% ความจุ (คาดการณ์)',
	colCheckin: 'เข้า',
	colCheckout: 'ออก',
	colMap: 'ตำแหน่งบนแผนที่',
	hasMapLocation: 'มีตำแหน่งบนแผนที่',
	noMapLocation: 'ไม่มีตำแหน่ง',
	dashboard: 'แดชบอร์ด',
	operationStatus: {
		standby: 'เตรียมการ',
		active: 'เปิดรับ',
		full_capacity: 'เต็มความจุ',
		closed: 'ปิดศูนย์',
		cancelled: 'ยกเลิกศูนย์',
		unknown: 'ไม่ทราบสถานะ'
	} as Record<string, string>,
	externalBadge: 'ศูนย์อพยพภายนอก',
	hiddenBadge: 'ซ่อนจากหน้าสาธารณะ',
	hiddenSitesCount: (hidden: number, total: number) =>
		`ซ่อนจากหน้าสาธารณะ ${hidden} ศูนย์ จากทั้งหมด ${total} ศูนย์`,

	// ---- filter bar
	filterSiteKind: 'ประเภทศูนย์',
	filterOperationStatus: 'สถานะศูนย์',
	filterStay: 'สถานะการเข้าพัก',
	filterPreRegSource: 'ประเภทการลงทะเบียนล่วงหน้า',
	filterPublicVisibility: 'การแสดงบนหน้าสาธารณะ',
	publicVisibility: {
		visible: 'แสดงบนหน้าสาธารณะ',
		hidden: 'ซ่อนจากหน้าสาธารณะ'
	} as Record<string, string>,
	filterHousehold: 'ครอบครัว',
	filterHouseholdPlaceholder: 'ทุกครอบครัวที่ลงทะเบียนไว้',
	filterSearch: 'ค้นหา',
	filterSearchPlaceholder: 'ชื่อ / เบอร์โทร...',
	stayBucket: {
		present: 'อยู่ในศูนย์',
		forecast: 'คาดการณ์',
		pre_registered: 'ลงทะเบียนล่วงหน้า',
		checked_out: 'ออกแล้ว'
	} as Record<string, string>,
	source: {
		unassigned: 'ยังไม่ได้เลือกศูนย์',
		bound: 'เลือกศูนย์แล้ว'
	} as Record<string, string>,

	// ---- age + nationality
	demographicsTitle: 'อายุและสัญชาติของผู้พักพิง',
	demographicsDescription: 'แสดงสัญชาติที่มีมากที่สุด กดชื่อประเทศเพื่อดูช่วงอายุ',
	ageBands: 'ช่วงอายุ',
	nationalities: 'สัญชาติ (มากที่สุด)',
	noNationalityData: 'ไม่มีข้อมูลสัญชาติ',
	unknownCountry: 'ไม่ระบุ',

	// ---- home area of pre-registered people
	originTitle: 'ภูมิลำเนาของผู้ลงทะเบียนล่วงหน้า',
	originDescription: 'จำนวนตามจังหวัด / อำเภอ / ตำบล และศูนย์ที่ผู้ลงทะเบียนเลือกไว้',
	originEmpty: 'ไม่พบข้อมูลภูมิลำเนา',
	province: 'จังหวัด',
	district: 'อำเภอ',
	subdistrict: 'ตำบล',
	originShelter: 'ศูนย์',
	originRange: (start: number, end: number, total: number) =>
		`แสดง ${start} - ${end} จาก ${total} แถว`,
	count: 'จำนวน'
};

const en: typeof th = {
	pageTitle: 'System overview',
	pageDescription: 'Shelter status, pre-registrations and movements across the whole system',
	errorTitle: 'Something went wrong',
	errorBody: 'Could not load the overview. Please try again.',
	all: 'All',

	preRegTitle: 'Pre-registered (waiting to arrive)',
	preRegDescription: 'People registered in advance who have not checked in yet',
	preRegNoShelter: 'No shelter chosen yet',
	preRegAtShelter: 'Pre-registered with a shelter chosen',
	inShelterTitle: 'In shelters',
	inShelterDescription: 'Current / forecast (excludes closed, cancelled and external shelters)',
	current: 'Current',
	forecast: 'Forecast',
	avgCapacityUse: 'Average capacity in use',
	hintCurrent:
		'People whose status is checked in, room confirmed or temporarily away from the shelter',
	hintForecast:
		'People in the shelter plus those who have registered or reported in, including those awaiting screening and placement',
	hintCapacityUse:
		'Share of the combined capacity of all shelters, calculated from total occupants against total capacity — not an average of each shelter’s percentage',
	avgCapacityValue: (now: string, forecast: string) => `Now ${now} · forecast ${forecast}`,

	siteUnit: 'shelters',
	externalSites: 'External shelters',
	closedOrCancelledSites: 'Closed / cancelled shelters',

	sitesTitle: 'All shelters',
	sitesDescription: 'Sorted by expected occupants as a share of capacity (high → low)',
	movementRange: 'Check-in / check-out date range',
	sitesEmpty: 'No shelters match the filters',
	colName: 'Name',
	colKind: 'Type',
	colStatus: 'Status',
	colPresent: 'Current',
	colForecast: 'Forecast',
	colPresentPct: '% of capacity (now)',
	colForecastPct: '% of capacity (forecast)',
	colCheckin: 'In',
	colCheckout: 'Out',
	colMap: 'Map location',
	hasMapLocation: 'Has map location',
	noMapLocation: 'No location',
	dashboard: 'Dashboard',
	operationStatus: {
		standby: 'Preparing',
		active: 'Open',
		full_capacity: 'At full capacity',
		closed: 'Closed',
		cancelled: 'Cancelled',
		unknown: 'Unknown'
	},
	externalBadge: 'External evacuation center',
	hiddenBadge: 'Hidden from the public site',
	hiddenSitesCount: (hidden: number, total: number) =>
		`${hidden} of ${total} shelters hidden from the public site`,

	filterSiteKind: 'Shelter type',
	filterOperationStatus: 'Shelter status',
	filterStay: 'Stay status',
	filterPreRegSource: 'Pre-registration type',
	filterPublicVisibility: 'On the public site',
	publicVisibility: {
		visible: 'Shown on the public site',
		hidden: 'Hidden from the public site'
	} as Record<string, string>,
	filterHousehold: 'Household',
	filterHouseholdPlaceholder: 'All registered households',
	filterSearch: 'Search',
	filterSearchPlaceholder: 'Name / phone...',
	stayBucket: {
		present: 'In the shelter',
		forecast: 'Forecast',
		pre_registered: 'Pre-registered',
		checked_out: 'Checked out'
	},
	source: {
		unassigned: 'No shelter chosen yet',
		bound: 'Shelter chosen'
	},

	demographicsTitle: 'Age and nationality of residents',
	demographicsDescription:
		'Shows the most common nationalities. Click a country to see its age groups.',
	ageBands: 'Age group',
	nationalities: 'Nationality (most common)',
	noNationalityData: 'No nationality data',
	unknownCountry: 'Unknown',

	originTitle: 'Home area of pre-registered people',
	originDescription: 'Counts by province / district / sub-district and the chosen shelter',
	originEmpty: 'No home-area data found',
	province: 'Province',
	district: 'District',
	subdistrict: 'Sub-district',
	originShelter: 'Shelter',
	originRange: (start: number, end: number, total: number) =>
		`Showing ${start} - ${end} of ${total} rows`,
	count: 'Count'
};

export const STAFF_SYSTEM_OVERVIEW_I18N = { th, en };
export type StaffSystemOverviewI18n = typeof th;
