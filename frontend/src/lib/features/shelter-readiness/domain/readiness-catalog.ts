import type { ReadinessCatalogItem, ReadinessSectionMeta, ReadinessTier } from './readiness.types';

export const READINESS_SECTIONS: readonly ReadinessSectionMeta[] = [
	{
		id: 'structure_and_space',
		label: 'ส่วนที่ 1 ด้านโครงสร้างและพื้นที่',
		shortLabel: 'โครงสร้างและพื้นที่'
	},
	{
		id: 'basic_needs',
		label: 'ส่วนที่ 2 ด้านปัจจัยขั้นพื้นฐาน และสิ่งของจำเป็น',
		shortLabel: 'ปัจจัยพื้นฐานและสิ่งของ'
	},
	{
		id: 'shelter_management',
		label: 'ส่วนที่ 3 ด้านบริหารจัดการศูนย์',
		shortLabel: 'การบริหารจัดการศูนย์'
	}
] as const;

export const COMMUNITY_CATALOG_ITEMS: readonly ReadinessCatalogItem[] = [
	// ส่วนที่ 1 ด้านโครงสร้างและพื้นที่
	// จำเป็นต้องมี (Mandatory)
	{
		id: 'comm_sec1_01',
		sectionId: 'structure_and_space',
		title:
			'ลักษณะบ้านและสถานที่สามารถจัดการให้เกิดความปลอดภัยต่อผู้พักพิงและมีทางเข้า–ออก และเส้นทางอพยพที่สะดวกและปลอดภัย',
		description: 'เช่น บ้านสองชั้นขึ้นไป ทางหนีไฟไม่มีสิ่งกีดขวาง เข้าถึงสะดวก',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec1_02',
		sectionId: 'structure_and_space',
		title: 'จุดคัดกรองเบื้องต้น',
		description: 'จำแนกกลุ่มเปราะบางและผู้มีความต้องการพิเศษ',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec1_03',
		sectionId: 'structure_and_space',
		title: 'จุดลงทะเบียน/ส่งต่อผู้พักพิง',
		description: 'มีการลงทะเบียน Check-in Check-out บันทึกข้อมูลพื้นฐานผู้พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec1_04',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ส่วนตัว/พื้นที่สำหรับนอน',
		description:
			'อย่างน้อย 3.5 ตารางเมตรต่อคน จัดพื้นที่ตามเพศ ครอบครัว และกลุ่มที่ต้องการความช่วยเหลือเฉพาะ มีแสงสว่างและการระบายอากาศเพียงพอ',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec1_05',
		sectionId: 'structure_and_space',
		title: 'สุขาภิบาล/ห้องน้ำ',
		description: 'มีห้องน้ำเพียงพอต่อจำนวนผู้พักพิง พร้อมอุปกรณ์ทำความสะอาด (1 ห้องต่อ 10 คน)',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec1_06',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ประกอบอาหาร',
		description: 'พื้นที่ประกอบอาหารสะอาด ปลอดภัยและจัดเก็บอาหารสำรองตามความเหมาะสม',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec1_07',
		sectionId: 'structure_and_space',
		title: 'พื้นที่รับประทานอาหาร',
		description: 'มีพื้นที่เพียงพอเป็นสัดส่วน ลดความแออัด',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec1_08',
		sectionId: 'structure_and_space',
		title: 'จุดให้บริการด้านสุขภาพ',
		description: 'มีจุดและอุปกรณ์ปฐมพยาบาลเบื้องต้น ยาสามัญ เวชภัณฑ์',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec1_09',
		sectionId: 'structure_and_space',
		title: 'ศูนย์อำนวยการ',
		description: 'มีผู้ดูแลรับผิดชอบศูนย์พักพิงและพื้นที่',
		importance: 'mandatory'
	},
	// สมควรจัดให้มี (Recommended)
	{
		id: 'comm_sec1_10',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ทางศาสนา',
		description: 'จัดพื้นที่ประกอบกิจกรรมทางศาสนาตามบริบทของศูนย์พักพิง',
		importance: 'recommended'
	},
	{
		id: 'comm_sec1_11',
		sectionId: 'structure_and_space',
		title: 'จุดรับ/แจกสิ่งของ',
		description: 'มีจุดรับ–แจกสิ่งของ และจุดจัดเก็บสิ่งของตามความเหมาะสม',
		importance: 'recommended'
	},
	{
		id: 'comm_sec1_12',
		sectionId: 'structure_and_space',
		title: 'พื้นที่สำหรับสัตว์เลี้ยง',
		description: 'มีพื้นที่แยกสัตว์เลี้ยงเป็นสัดส่วน',
		importance: 'recommended'
	},
	// จัดให้มีหรือไม่มีก็ได้ (Optional)
	{
		id: 'comm_sec1_13',
		sectionId: 'structure_and_space',
		title: 'พื้นที่นันทนาการ',
		description: 'มีกิจกรรมเบื้องต้นสำหรับผู้พักพิงแต่ละกลุ่มวัย',
		importance: 'optional'
	},
	{
		id: 'comm_sec1_14',
		sectionId: 'structure_and_space',
		title: 'พื้นที่อาชีวบำบัด',
		description: 'มีพื้นที่ที่ช่วยให้ผู้พักพิงได้ทำกิจกรรมเพื่อผ่อนคลายและฟื้นฟู',
		importance: 'optional'
	},
	{
		id: 'comm_sec1_15',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ให้บริการคำปรึกษา/นักกิจกรรมบำบัดนักจิตวิทยา',
		description:
			'ช่องทางรับฟังปัญหาและให้คำปรึกษา พร้อมช่องทางส่งต่อไปยังเจ้าหน้าที่สาธารณสุขหรือหน่วยงานที่เกี่ยวข้อง',
		importance: 'optional'
	},

	// ส่วนที่ 2 ด้านปัจจัยขั้นพื้นฐาน และสิ่งของจำเป็น
	// จำเป็นต้องมี (Mandatory)
	{
		id: 'comm_sec2_01',
		sectionId: 'basic_needs',
		title: 'น้ำเพื่ออุปโภค - บริโภคเฉลี่ย',
		description:
			'7.5–15 ลิตรต่อคนต่อวัน น้ำต้องสะอาดปลอดภัย (น้ำดื่ม 2.5-3.5 ลิตร, น้ำทำอาหาร 3-6 ลิตร, น้ำทำความสะอาดร่างกาย 2-6 ลิตร)',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec2_02',
		sectionId: 'basic_needs',
		title: 'อาหารและโภชนาการ',
		description: 'เพียงพอต่อจำนวนผู้พักพิง สะอาด และถูกสุขลักษณะ',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec2_03',
		sectionId: 'basic_needs',
		title: 'สุขาภิบาลและสุขอนามัย',
		description:
			'มีอุปกรณ์สุขอนามัยและอุปกรณ์ทำความสะอาด เช่น หน้ากากอนามัย ผ้าอนามัย เจลแอลกอฮอล์ ไม้กวาด ไม้ถูพื้น',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec2_04',
		sectionId: 'basic_needs',
		title: 'การแพทย์ และสาธารณสุข',
		description: 'มียาสามัญ เวชภัณฑ์ และการปฐมพยาบาลเบื้องต้น',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec2_05',
		sectionId: 'basic_needs',
		title: 'เครื่องนุ่งห่มและของใช้จำเป็น',
		description: 'มีเพียงพอตามจำนวนและความต้องการของผู้พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec2_06',
		sectionId: 'basic_needs',
		title: 'สิ่งอำนวยความสะดวกสำหรับกลุ่มเปราะบาง',
		description: 'มีอุปกรณ์อำนวยความสะดวก เช่น วีลแชร์ ไม้เท้า walker',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec2_07',
		sectionId: 'basic_needs',
		title: 'อุปกรณ์ความปลอดภัยและกู้ภัยทางน้ำ',
		description: 'มีอุปกรณ์กู้ภัยทางน้ำเบื้องต้น เช่น เสื้อชูชีพ ห่วง เชือก ไฟฉาย',
		importance: 'mandatory'
	},
	// สมควรจัดให้มี (Recommended)
	{
		id: 'comm_sec2_08',
		sectionId: 'basic_needs',
		title: 'อาหารและโภชนาการเฉพาะกลุ่ม',
		description: 'จัดเตรียมอาหารตามความจำเป็นเฉพาะกลุ่ม เช่น เด็กเล็ก ผู้สูงอายุ ผู้ป่วย',
		importance: 'recommended'
	},
	{
		id: 'comm_sec2_09',
		sectionId: 'basic_needs',
		title: 'จุดชาร์จไฟ/สัญญาณอินเทอร์เน็ต',
		description: 'มีจุดชาร์จไฟและช่องทางสื่อสารพื้นฐานสำหรับผู้พักพิง',
		importance: 'recommended'
	},
	// จัดให้มีหรือไม่มีก็ได้ (Optional)
	{
		id: 'comm_sec2_10',
		sectionId: 'basic_needs',
		title: 'ป้าย/ข้อมูลข่าวสารในศูนย์',
		description: 'มีการอัปเดตข้อมูลข่าวสารอย่างต่อเนื่อง',
		importance: 'optional'
	},

	// ส่วนที่ 3 ด้านบริหารจัดการศูนย์
	// จำเป็นต้องมี (Mandatory)
	{
		id: 'comm_sec3_01',
		sectionId: 'shelter_management',
		title: 'ผู้รับผิดชอบศูนย์พักพิง/พื้นที่',
		description: 'เจ้าของพื้นที่ หรือผู้ได้รับมอบหมาย รับผิดชอบการบริหารและประสานงาน',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec3_02',
		sectionId: 'shelter_management',
		title: 'การลงทะเบียนของผู้พักพิง',
		description: 'มีทะเบียนผู้พักพิง ข้อมูลเข้า–ออก และข้อมูลพื้นฐานที่จำเป็น',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec3_03',
		sectionId: 'shelter_management',
		title: 'ระบบกักเก็บ และระบายน้ำ',
		description: 'มีระบบกักเก็บน้ำและช่องทางระบายน้ำในพื้นที่ศูนย์พักพิงระดับพื้นฐาน',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec3_04',
		sectionId: 'shelter_management',
		title: 'ระบบการจัดการสิ่งปฏิกูล',
		description: 'มีการจัดเก็บขยะและสิ่งปฏิกูลอย่างถูกสุขลักษณะ',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec3_05',
		sectionId: 'shelter_management',
		title: 'ระบบการติดต่อสื่อสารข้อมูล',
		description: 'มีโทรศัพท์ วิทยุ ช่องทางสื่อสาร และมีผู้รับผิดชอบการติดต่อสื่อสาร',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec3_06',
		sectionId: 'shelter_management',
		title: 'การสื่อสารประชาสัมพันธ์',
		description: 'สื่อสารข้อมูลสถานการณ์ กติกา และกิจกรรมประจำวันให้ผู้พักพิงทราบอย่างทั่วถึง',
		importance: 'mandatory'
	},
	{
		id: 'comm_sec3_07',
		sectionId: 'shelter_management',
		title: 'การมีส่วนร่วม',
		description: 'ผู้พักพิงมีส่วนร่วมในการกำหนดกติกาในการอยู่ร่วมกัน',
		importance: 'mandatory'
	},
	// สมควรจัดให้มี (Recommended)
	{
		id: 'comm_sec3_08',
		sectionId: 'shelter_management',
		title: 'การคุ้มครอง และระบบความปลอดภัย',
		description: 'มีกติกาการอยู่ร่วมกัน และมาตรการคุ้มครองกลุ่มเปราะบาง',
		importance: 'recommended'
	},
	{
		id: 'comm_sec3_09',
		sectionId: 'shelter_management',
		title: 'การประสานและเชื่อมโยงระบบบริการและทรัพยากร',
		description: 'ประสานผู้นำชุมชน อาสาสมัคร คณะทำงาน และหน่วยงานในพื้นที่เพื่อขอรับการสนับสนุน',
		importance: 'recommended'
	},
	{
		id: 'comm_sec3_10',
		sectionId: 'shelter_management',
		title: 'ระบบไฟฟ้า',
		description: 'ไฟฟ้าเพียงพอสำหรับการพักพิง การสื่อสาร และความปลอดภัย พร้อมระบบไฟฟ้าสำรอง',
		importance: 'recommended'
	},
	{
		id: 'comm_sec3_11',
		sectionId: 'shelter_management',
		title: 'กำหนดกิจกรรมประจำวัน',
		description: 'มีตารางการจัดกิจกรรมตามกลุ่มวัยหรือความต้องการ และมีผู้รับผิดชอบชัดเจน',
		importance: 'recommended'
	},
	// จัดให้มีหรือไม่มีก็ได้ (Optional)
	{
		id: 'comm_sec3_12',
		sectionId: 'shelter_management',
		title: 'ระบบแสดงข้อมูลผู้พักพิง',
		description: 'มีข้อมูลพื้นฐานของผู้พักพิงแบบ Real-time',
		importance: 'optional'
	},
	{
		id: 'comm_sec3_13',
		sectionId: 'shelter_management',
		title: 'จุดบริการสื่อสารและติดต่อญาติ',
		description: 'มีช่องทางสื่อสารให้ผู้พักพิงติดต่อครอบครัวและญาติ',
		importance: 'optional'
	}
] as const;

export const LOCAL_ADMIN_CATALOG_ITEMS: readonly ReadinessCatalogItem[] = [
	// ส่วนที่ 1 ด้านโครงสร้างและพื้นที่
	// จำเป็นต้องมี (Mandatory)
	{
		id: 'local_sec1_01',
		sectionId: 'structure_and_space',
		title: 'อาคารที่มีโครงสร้างมั่นคงแข็งแรง',
		description:
			'ลักษณะสถานที่สามารถจัดการให้เกิดความปลอดภัยต่อผู้พักพิง มีทางเข้า–ออก และเส้นทางอพยพที่สะดวก ปลอดภัย มีการแบ่งสัดส่วนพื้นที่อย่างชัดเจน เช่น วัด มัสยิด โรงเรียน โรงแรม',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_02',
		sectionId: 'structure_and_space',
		title: 'จุดคัดกรองจำแนกกลุ่มเปราะบาง',
		description:
			'มีเจ้าหน้าที่หรือบุคลากรที่เกี่ยวข้องร่วมคัดกรอง มีแบบฟอร์มและระบบส่งต่อกลุ่มเปราะบางอย่างเป็นระบบ',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_03',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ลงทะเบียน/ส่งต่อผู้พักพิง',
		description: 'มีระบบลงทะเบียนกลางของศูนย์ ตรวจสอบจำนวนผู้พักพิงและรายงานข้อมูลได้',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_04',
		sectionId: 'structure_and_space',
		title: 'พื้นที่นอน',
		description:
			'จัดให้มีความเป็นส่วนตัว ปลอดภัย และเข้าถึงได้ตามหลัก Universal Design พร้อมกำหนดโซนผู้พักพิงอย่างเหมาะสม',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_05',
		sectionId: 'structure_and_space',
		title: 'สุขาภิบาล/ห้องน้ำ',
		description:
			'เพียงพอต่อจำนวน มีแผนบริหารจัดการห้องน้ำ น้ำเสีย ขยะ และสิ่งปฏิกูล แบ่งโซนห้องน้ำชาย-หญิง และกลุ่มเปราะบาง มีผู้รับผิดชอบตรวจติดตามความสะอาดสม่ำเสมอ',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_06',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ประกอบอาหาร',
		description:
			'ถูกสุขลักษณะ แบ่งโซนพื้นที่เตรียม-ปรุง-แจกจ่ายอาหาร และแบ่งโซนครัวเฉพาะกลุ่ม เช่น ครัวฮาลาล',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_07',
		sectionId: 'structure_and_space',
		title: 'พื้นที่รับประทานอาหาร',
		description: 'มีระบบจัดคิวและแบ่งพื้นที่ตามความเหมาะสมของผู้พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_08',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ให้บริการด้านสุขภาพ',
		description:
			'มีพื้นที่ให้บริการด้านสุขภาพเป็นสัดส่วน มีบุคลากรสาธารณสุขและทีมสหวิชาชีพให้บริการผู้พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_09',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ทางศาสนา',
		description: 'จัดพื้นที่เป็นสัดส่วนและคำนึงถึงความแตกต่างด้านศาสนาและวัฒนธรรม',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_10',
		sectionId: 'structure_and_space',
		title: 'จุดรับ/แจกสิ่งของ',
		description: 'มีระบบคลังสิ่งของ การจัดคิว การบันทึกสิ่งของเข้า–ออก และมีผู้รับผิดชอบชัดเจน',
		importance: 'mandatory'
	},
	{
		id: 'local_sec1_11',
		sectionId: 'structure_and_space',
		title: 'ศูนย์อำนวยการ',
		description:
			'มีศูนย์อำนวยการและศูนย์ปฏิบัติการฉุกเฉินท้องถิ่น ทำหน้าที่ประสานงานและระดมทรัพยากร',
		importance: 'mandatory'
	},
	// สมควรจัดให้มี (Recommended)
	{
		id: 'local_sec1_12',
		sectionId: 'structure_and_space',
		title: 'จุดจอดรถ',
		description: 'มีพื้นที่จอดรถพร้อมระบบจราจร เส้นทางเข้า–ออกสะดวกและปลอดภัย',
		importance: 'recommended'
	},
	{
		id: 'local_sec1_13',
		sectionId: 'structure_and_space',
		title: 'พื้นที่สำหรับปศุสัตว์และสัตว์เลี้ยง',
		description: 'มีพื้นที่แยกประเภทและพื้นที่กักกันสัตว์ พร้อมระบบบันทึกข้อมูลสัตว์เลี้ยง',
		importance: 'recommended'
	},
	{
		id: 'local_sec1_14',
		sectionId: 'structure_and_space',
		title: 'พื้นที่อาชีวบำบัด',
		description: 'มีพื้นที่จัดกิจกรรมฟื้นฟูฝึกอาชีพที่เชื่อมโยงกับหน่วยงานในพื้นที่',
		importance: 'recommended'
	},
	{
		id: 'local_sec1_15',
		sectionId: 'structure_and_space',
		title: 'พื้นที่นันทนาการ',
		description: 'จัดกิจกรรมตามกลุ่มวัยและความต้องการของผู้พักพิง เช่น เด็ก ผู้ใหญ่ ผู้สูงอายุ',
		importance: 'recommended'
	},
	{
		id: 'local_sec1_16',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ให้บริการคำปรึกษา',
		description:
			'มีพื้นที่ให้บริการโดยผู้เชี่ยวชาญ ทีมสหวิชาชีพ เช่น นักกิจกรรมบำบัด นักจิตวิทยา นักสังคมสงเคราะห์ และมีมาตรการคุ้มครองข้อมูลผู้พักพิง',
		importance: 'recommended'
	},

	// ส่วนที่ 2 ด้านปัจจัยขั้นพื้นฐาน และสิ่งของจำเป็น
	// จำเป็นต้องมี (Mandatory)
	{
		id: 'local_sec2_01',
		sectionId: 'basic_needs',
		title: 'น้ำเพื่ออุปโภค - บริโภค',
		description:
			'ปริมาณความเพียงพอในการใช้น้ำเฉลี่ย 7.5–15 ลิตรต่อคนต่อวัน มีระบบสำรองและกระจายน้ำให้เพียงพอตามจำนวนผู้พักพิง พร้อมติดตามปริมาณการใช้น้ำ โดยคำนึงถึงคุณภาพของน้ำเป็นหลัก',
		importance: 'mandatory'
	},
	{
		id: 'local_sec2_02',
		sectionId: 'basic_needs',
		title: 'อาหารและโภชนาการ',
		description:
			'เพียงพอต่อจำนวนผู้พักพิง สะอาด ถูกสุขลักษณะ พร้อมระบบจัดหา จัดเก็บอาหาร ปรุงอาหาร แจกจ่ายอาหาร และแยกอาหารเฉพาะกลุ่ม เช่น อาหารฮาลาล อาหารมังสวิรัติ',
		importance: 'mandatory'
	},
	{
		id: 'local_sec2_03',
		sectionId: 'basic_needs',
		title: 'สุขาภิบาลและสุขอนามัย',
		description: 'มีระบบจัดการขยะ น้ำเสีย ความสะอาดห้องน้ำ และสุขอนามัยของศูนย์พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'local_sec2_04',
		sectionId: 'basic_needs',
		title: 'การแพทย์ และสาธารณสุข',
		description:
			'มียาสามัญ เวชภัณฑ์ การปฐมพยาบาลที่จำเป็น และจัดให้มีบุคลากรสาธารณสุข และระบบส่งต่อผู้ป่วยไปยังสถานพยาบาล',
		importance: 'mandatory'
	},
	{
		id: 'local_sec2_05',
		sectionId: 'basic_needs',
		title: 'เครื่องนุ่งห่ม',
		description: 'มีเครื่องนุ่งห่ม และของใช้จำเป็นตามจำนวนและความต้องการของผู้พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'local_sec2_06',
		sectionId: 'basic_needs',
		title: 'อาหารและโภชนาการเฉพาะกลุ่ม',
		description: 'จัดเตรียมอาหาร และมีฐานข้อมูลความต้องการด้านอาหารเฉพาะกลุ่ม',
		importance: 'mandatory'
	},
	{
		id: 'local_sec2_07',
		sectionId: 'basic_needs',
		title: 'จุดชาร์จไฟ/สัญญาณอินเทอร์เน็ต',
		description: 'มีระบบอินเทอร์เน็ตและการสื่อสาร พร้อมช่องทางสำรองเมื่อระบบหลักขัดข้อง',
		importance: 'mandatory'
	},
	{
		id: 'local_sec2_08',
		sectionId: 'basic_needs',
		title: 'อุปกรณ์ความปลอดภัยและกู้ภัยทางน้ำ',
		description:
			'อุปกรณ์กู้ภัยที่สามารถสนับสนุนการอพยพ เช่น เรือกู้ภัย/เรือท้องแบน, วิทยุสื่อสาร, เปล/กระดานเคลื่อนย้ายผู้ประสบภัย, เครื่องสูบน้ำ เป็นต้น',
		importance: 'mandatory'
	},
	// สมควรจัดให้มี (Recommended)
	{
		id: 'local_sec2_09',
		sectionId: 'basic_needs',
		title: 'สิ่งอำนวยความสะดวกสำหรับกลุ่มเปราะบาง',
		description:
			'มีสิ่งอำนวยความสะดวกเป็นไปตามหลัก Universal Design และมีเจ้าหน้าที่ดูแลกลุ่มเปราะบาง (ตามความเหมาะสมกับพื้นที่)',
		importance: 'recommended'
	},
	{
		id: 'local_sec2_10',
		sectionId: 'basic_needs',
		title: 'ป้าย/ข้อมูลข่าวสารในศูนย์',
		description:
			'มีระบบประชาสัมพันธ์ภายใน เช่น บอร์ด แผนผัง โครงสร้างผู้รับผิดชอบ และข้อมูลสถานการณ์',
		importance: 'recommended'
	},

	// ส่วนที่ 3 ด้านบริหารจัดการศูนย์
	// จำเป็นต้องมี (Mandatory)
	{
		id: 'local_sec3_01',
		sectionId: 'shelter_management',
		title: 'ผู้รับผิดชอบศูนย์พักพิง/พื้นที่',
		description:
			'นายกเทศมนตรี/นายก อบต. หรือผู้ได้รับมอบหมาย ทำหน้าที่อำนวยการและประสานทรัพยากรในพื้นที่',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_02',
		sectionId: 'shelter_management',
		title: 'ระบบลงทะเบียนผู้อพยพ',
		description:
			'ระบบลงทะเบียนออนไลน์ของผู้พักพิง มีฐานข้อมูลกลางของศูนย์ในพื้นที่ อปท. และรายงานจำนวนผู้พักพิงได้',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_03',
		sectionId: 'shelter_management',
		title: 'ระบบไฟฟ้า',
		description:
			'ครอบคลุมทั่วทั้งศูนย์พักพิง รวมถึงมีระบบไฟฟ้าสำรองสำหรับใช้งานเพียงพอในกรณีฉุกเฉิน',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_04',
		sectionId: 'shelter_management',
		title: 'ระบบกักเก็บและระบายน้ำ',
		description: 'มีแผนบริหารน้ำและระบบสำรองน้ำใช้เพียงพอต่อความต้องการของผู้พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_05',
		sectionId: 'shelter_management',
		title: 'ระบบการจัดการสิ่งปฏิกูล',
		description: 'มีผู้รับผิดชอบและระบบจัดเก็บ ขนย้าย และกำจัดขยะและสิ่งปฏิกูลของศูนย์',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_06',
		sectionId: 'shelter_management',
		title: 'ระบบการติดต่อสื่อสารข้อมูล',
		description: 'มีระบบสื่อสารภายในและภายนอก รวมทั้งช่องทางสำรองเมื่อระบบหลักล่ม',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_07',
		sectionId: 'shelter_management',
		title: 'การคุ้มครอง และระบบความปลอดภัย',
		description: 'มีระบบรักษาความปลอดภัย ระบบร้องเรียน และกลไกจัดการความขัดแย้ง',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_08',
		sectionId: 'shelter_management',
		title: 'การประสานและเชื่อมโยงระบบบริการและทรัพยากร',
		description: 'มีผู้ประสานงานศูนย์และกลไกการประสานหน่วยงานภาครัฐ เอกชน และองค์กรที่เกี่ยวข้อง',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_09',
		sectionId: 'shelter_management',
		title: 'การสื่อสารประชาสัมพันธ์',
		description: 'ระบบประชาสัมพันธ์และช่องทางสื่อสารกับหน่วยงานภายนอกอย่างเป็นทางการ',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_10',
		sectionId: 'shelter_management',
		title: 'กำหนดกิจกรรมประจำวัน',
		description: 'มีตารางจัดกิจกรรมตามกลุ่มวัยหรือความต้องการ และมีผู้รับผิดชอบชัดเจน',
		importance: 'mandatory'
	},
	{
		id: 'local_sec3_11',
		sectionId: 'shelter_management',
		title: 'จุดบริการสื่อสารและติดต่อญาติ',
		description: 'มีพื้นที่บริการสื่อสารและมีเจ้าหน้าที่ช่วยเหลือผู้ที่มีข้อจำกัดด้านการสื่อสาร',
		importance: 'mandatory'
	},
	// สมควรจัดให้มี (Recommended)
	{
		id: 'local_sec3_12',
		sectionId: 'shelter_management',
		title: 'ระบบแสดงข้อมูลผู้พักพิง',
		description:
			'มีระบบข้อมูลจำนวนผู้พักพิงแยกตามเพศ อายุ และความต้องการ เพื่อใช้วางแผนบริหารจัดการ',
		importance: 'recommended'
	},
	{
		id: 'local_sec3_13',
		sectionId: 'shelter_management',
		title: 'การมีส่วนร่วม',
		description:
			'มีคณะกรรมการศูนย์ และกลไกที่เปิดให้ผู้พักพิงและภาคีในพื้นที่มีส่วนร่วมในการบริหารและจัดการศูนย์พักพิง',
		importance: 'recommended'
	}
] as const;

export const CITY_CATALOG_ITEMS: readonly ReadinessCatalogItem[] = [
	// ทุกข้อในระดับเมืองเป็น mandatory
	// ส่วนที่ 1 ด้านโครงสร้างและพื้นที่
	{
		id: 'city_sec1_01',
		sectionId: 'structure_and_space',
		title: 'พื้นที่มีโครงสร้างมั่นคงแข็งแรง',
		description:
			'มีระบบจัดการพื้นที่ใช้งานเป็นสัดส่วน และรองรับผู้อพยพทุกกลุ่ม มีการจัดโซนผู้พักพิงตามประเภท และความต้องการ มีแผนผังการใช้พื้นที่ที่ชัดเจน มีทางเข้า–ออกสะดวกและปลอดภัย เช่น มหาวิทยาลัย',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_02',
		sectionId: 'structure_and_space',
		title: 'พื้นที่คัดกรองจำแนกกลุ่มเปราะบาง',
		description:
			'มีระบบคัดกรองเชื่อมโยงฐานข้อมูลสุขภาพและระบบส่งต่อระหว่างหน่วยงานและสถานพยาบาลตามความจำเป็น',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_03',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ลงทะเบียน/ส่งต่อผู้พักพิง',
		description:
			'พร้อมระบบลงทะเบียนดิจิทัลระดับเมือง เชื่อมโยงข้อมูลทุกศูนย์ สามารถติดตามจำนวน การเคลื่อนย้าย และความต้องการของผู้พักพิงแบบ Real-time โดยคำนึงถึงการคุ้มครองข้อมูลส่วนบุคคล',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_04',
		sectionId: 'structure_and_space',
		title: 'พื้นที่นอน',
		description:
			'จัดพื้นที่นอนให้มีความเป็นส่วนตัว มีการออกแบบพื้นที่ตามหลักความปลอดภัย ความเป็นส่วนตัว Universal Design และติดตามความหนาแน่นของผู้พักพิงเพื่อบริหารการกระจายตัว',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_05',
		sectionId: 'structure_and_space',
		title: 'สุขาภิบาล/ห้องน้ำ',
		description:
			'เพียงพอต่อจำนวนผู้พักพิง มีระบบบริหารสุขาภิบาลเชื่อมโยงทุกศูนย์ และสามารถสนับสนุนศูนย์ที่มีผู้พักพิงเกินขีดความสามารถ (ห้องน้ำ 1 ห้องต่อผู้หญิง 20 คน, 1 ห้องพร้อมโถปัสสาวะต่อผู้ชาย 35 คน)',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_06',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ประกอบอาหาร',
		description:
			'แบ่งพื้นที่ครัวที่ถูกสุขลักษณะตามมาตรฐาน มีระบบบริหารอาหารและโภชนาการเชื่อมโยงหลายศูนย์ สามารถประเมินจำนวนผู้พักพิงและวางแผนจัดสรรอาหารตามข้อมูลจริง และมีครัวฮาลาลแยกสัดส่วนชัดเจน',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_07',
		sectionId: 'structure_and_space',
		title: 'พื้นที่รับประทานอาหาร',
		description:
			'มีระบบบริหารจัดสรรพื้นที่ จัดคิวการแจกจ่ายอาหาร แบ่งโซนพื้นที่ และแยกภาชนะระหว่างอาหารทั่วไปกับอาหารฮาลาล',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_08',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ให้บริการด้านสุขภาพ',
		description:
			'มีระบบเชื่อมโยงบริการสุขภาพ โรงพยาบาล และหน่วยงานสาธารณสุข เพื่อรองรับผู้ป่วยและกลุ่มเปราะบางในศูนย์พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_09',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ทางศาสนา',
		description: 'มีระบบสนับสนุนการจัดพื้นที่กิจกรรมทางศาสนาที่เหมาะสมกับความหลากหลายของผู้พักพิง',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_10',
		sectionId: 'structure_and_space',
		title: 'จุดรับ/แจกสิ่งของ',
		description:
			'มีฐานข้อมูลทรัพยากรและระบบติดตามการกระจายสิ่งของระหว่างศูนย์แบบ Real-time เพื่อลดการกระจุกตัวของทรัพยากร',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_11',
		sectionId: 'structure_and_space',
		title: 'ศูนย์อำนวยการ',
		description:
			'มีศูนย์บัญชาการและกลไกระดับเมือง เชื่อมโยงข้อมูลจากศูนย์พักพิงทุกแห่งและหน่วยงานที่เกี่ยวข้องเพื่อสนับสนุนการตัดสินใจ',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_12',
		sectionId: 'structure_and_space',
		title: 'จุดจอดรถ',
		description:
			'มีระบบบริหารการจราจรและการเข้าถึงศูนย์พักพิงทั้งเมือง พร้อมเส้นทางฉุกเฉินและระบบบริหารการเดินทางที่ชัดเจน',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_13',
		sectionId: 'structure_and_space',
		title: 'พื้นที่สำหรับปศุสัตว์และสัตว์เลี้ยง',
		description:
			'มีผู้เชี่ยวชาญเฉพาะ มีฐานข้อมูลสัตว์เลี้ยงและปศุสัตว์ระดับเมือง และระบบจัดสรรพื้นที่ทรัพยากรสำหรับสัตว์ในแต่ละศูนย์',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_14',
		sectionId: 'structure_and_space',
		title: 'พื้นที่อาชีวบำบัด',
		description:
			'มีระบบเชื่อมโยงการฝึกอาชีพกับหน่วยงาน ตลาดแรงงาน และทรัพยากรของเมืองเพื่อสนับสนุนการฟื้นฟูหลังภัยพิบัติ',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_15',
		sectionId: 'structure_and_space',
		title: 'พื้นที่นันทนาการ',
		description:
			'มีระบบกิจกรรมฟื้นฟูสุขภาวะและสุขภาพจิตที่เชื่อมโยงหน่วยงานผู้เชี่ยวชาญหลายภาคส่วน',
		importance: 'mandatory'
	},
	{
		id: 'city_sec1_16',
		sectionId: 'structure_and_space',
		title: 'พื้นที่ให้บริการคำปรึกษา, นักกิจกรรมบำบัด, นักจิตวิทยา',
		description:
			'มีบริการโดยผู้เชี่ยวชาญทีมสหวิชาชีพ และมีระบบส่งต่อด้านสังคม สุขภาพจิต และบริการสังคมระหว่างศูนย์กับหน่วยงานที่เกี่ยวข้อง',
		importance: 'mandatory'
	},

	// ส่วนที่ 2 ด้านปัจจัยขั้นพื้นฐาน และสิ่งของจำเป็น
	{
		id: 'city_sec2_01',
		sectionId: 'basic_needs',
		title: 'น้ำเพื่ออุปโภค - บริโภค',
		description:
			'ปริมาณความเพียงพอในการใช้น้ำเฉลี่ย 7.5–15 ลิตรต่อคนต่อวัน มีระบบสำรองและกระจายน้ำให้เพียงพอตามจำนวนผู้พักพิง พร้อมติดตามปริมาณการใช้น้ำ โดยคำนึงถึงคุณภาพของน้ำเป็นหลัก',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_02',
		sectionId: 'basic_needs',
		title: 'อาหารและโภชนาการ',
		description:
			'มีระบบบริหารอาหาร สามารถจัดสรรอาหารตามความต้องการจากฐานข้อมูลผู้พักพิง และจัดสรรอาหารเฉพาะกลุ่มผู้พักพิงตามความเหมาะสม',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_03',
		sectionId: 'basic_needs',
		title: 'สุขาภิบาลและสุขอนามัย',
		description:
			'มีระบบจัดการ ดูแลความสะอาด จัดการสิ่งปฏิกูลและสุขอนามัยของศูนย์พักพิง และติดตามมาตรฐานสุขาภิบาลทุกศูนย์ รวมถึงกลไกสนับสนุนทรัพยากรให้กับศูนย์พักพิงอื่น ๆ',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_04',
		sectionId: 'basic_needs',
		title: 'การแพทย์ และสาธารณสุข',
		description:
			'เชื่อมโยงฐานข้อมูลระบบบริการสุขภาพของศูนย์กับเครือข่ายสาธารณสุขเพื่อบริหารผู้ป่วยและกลุ่มเปราะบาง',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_05',
		sectionId: 'basic_needs',
		title: 'เครื่องนุ่งห่ม',
		description:
			'มีคลังทรัพยากรกลางและระบบกระจายเครื่องนุ่งห่มระหว่างศูนย์ตามข้อมูลความต้องการแบบ Real-time',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_06',
		sectionId: 'basic_needs',
		title: 'อาหารและโภชนาการเฉพาะกลุ่ม',
		description:
			'มีระบบบริหารอาหารเฉพาะกลุ่ม เชื่อมโยงศูนย์พักพิง หน่วยงานสาธารณสุข และผู้สนับสนุนทรัพยากร',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_07',
		sectionId: 'basic_needs',
		title: 'ป้าย/ข้อมูลข่าวสารในศูนย์',
		description:
			'มีระบบข้อมูลกลางที่สามารถแสดงสถานการณ์ จำนวนผู้พักพิง บริการ และทรัพยากรของศูนย์ต่าง ๆ แบบ Real-time',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_08',
		sectionId: 'basic_needs',
		title: 'จุดชาร์จไฟ/สัญญาณอินเทอร์เน็ต',
		description:
			'มีโครงข่ายสื่อสารสำรองและระบบเชื่อมโยงข้อมูลทุกศูนย์กับศูนย์บัญชาการ/หน่วยงานที่เกี่ยวข้อง',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_09',
		sectionId: 'basic_needs',
		title: 'สิ่งอำนวยความสะดวกสำหรับกลุ่มเปราะบาง',
		description:
			'มีมาตรฐาน Universal Design ร่วมกันทุกศูนย์ และมีระบบบริหารข้อมูลความต้องการเฉพาะบุคคลเพื่อจัดบริการและส่งต่อ',
		importance: 'mandatory'
	},
	{
		id: 'city_sec2_10',
		sectionId: 'basic_needs',
		title: 'อุปกรณ์ความปลอดภัยและกู้ภัยทางน้ำ',
		description:
			'กู้ภัยทางน้ำแบบครบวงจรและบูรณาการหลายหน่วยงาน เช่น เรือกู้ภัย, เรือพร้อมเครื่องยนต์และอุปกรณ์กู้ชีพ, อุปกรณ์ค้นหาและช่วยเหลือ, เสื้อชูชีพและอุปกรณ์ป้องกันครบชุด, วิทยุสื่อสาร, GPS/ระบบติดตามตำแหน่ง, เครื่องสูบน้ำขนาดใหญ่, รถ/พาหนะ',
		importance: 'mandatory'
	},

	// ส่วนที่ 3 ด้านบริหารจัดการศูนย์
	{
		id: 'city_sec3_01',
		sectionId: 'shelter_management',
		title: 'ผู้รับผิดชอบศูนย์พักพิง/พื้นที่',
		description:
			'ผู้มีอำนาจตามโครงสร้างการจัดการสาธารณภัยระดับเมือง/จังหวัด ทำหน้าที่กำกับ บัญชาการ และบูรณาการหลายหน่วยงาน',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_02',
		sectionId: 'shelter_management',
		title: 'ระบบลงทะเบียนผู้พักพิง',
		description:
			'มีฐานข้อมูลกลางระดับเมือง เชื่อมโยงทุกศูนย์ ติดตามผู้พักพิงและสนับสนุนการตัดสินใจแบบ Real-time',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_03',
		sectionId: 'shelter_management',
		title: 'ระบบไฟฟ้า',
		description: 'มีระบบสำรองพลังงานและแผนบริหารพลังงานสำหรับศูนย์พักพิงทั้งเมือง',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_04',
		sectionId: 'shelter_management',
		title: 'ระบบกักเก็บและระบายน้ำ',
		description:
			'มีระบบข้อมูลความเสี่ยงน้ำท่วมและแผนบริหารน้ำเชื่อมโยงศูนย์พักพิงหลายแห่งในระดับเมือง',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_05',
		sectionId: 'shelter_management',
		title: 'ระบบการจัดการสิ่งปฏิกูล',
		description:
			'มีระบบบริหารจัดการขยะและสิ่งปฏิกูลเชื่อมโยงกับระบบเมือง และสามารถสนับสนุนศูนย์ที่มีภาระเกินขีดความสามารถ',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_06',
		sectionId: 'shelter_management',
		title: 'ระบบการติดต่อสื่อสารข้อมูล',
		description:
			'มีระบบสื่อสารและข้อมูลกลาง เชื่อมโยงทุกศูนย์กับศูนย์บัญชาการและหน่วยงานที่เกี่ยวข้อง',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_07',
		sectionId: 'shelter_management',
		title: 'การคุ้มครอง และระบบความปลอดภัย',
		description:
			'มีระบบรักษาความปลอดภัยเชื่อมโยงหลายศูนย์ มีระบบแจ้งเหตุ เฝ้าระวัง และกลไกคุ้มครองผู้พักพิงระดับเมือง',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_08',
		sectionId: 'shelter_management',
		title: 'การประสานและเชื่อมโยงระบบบริการและทรัพยากร',
		description:
			'มีศูนย์ประสานงานระดับเมือง เชื่อมโยงศูนย์พักพิง หน่วยงานรัฐ เอกชน และภาคประชาสังคม รวมถึงการกระจายทรัพยากรข้ามศูนย์',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_09',
		sectionId: 'shelter_management',
		title: 'การสื่อสารประชาสัมพันธ์',
		description:
			'มีระบบสื่อสารสาธารณะระดับเมือง สามารถเผยแพร่ข้อมูลศูนย์พักพิงและสถานการณ์ให้ประชาชนและหน่วยงานที่เกี่ยวข้องรับทราบแบบ Real-time',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_10',
		sectionId: 'shelter_management',
		title: 'กำหนดกิจกรรมประจำวัน',
		description:
			'มีแผนกิจกรรมประจำวันชัดเจน และสามารถปรับแผนตามสถานการณ์และเชื่อมโยงทรัพยากรจากหลายหน่วยงานภายในและภายนอก',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_11',
		sectionId: 'shelter_management',
		title: 'ระบบแสดงข้อมูลผู้พักพิง',
		description:
			'มี Dashboard ระดับเมืองแสดงสถานะ จำนวนผู้พักพิง ความจุ ทรัพยากร และความต้องการของแต่ละศูนย์แบบ Real-time',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_12',
		sectionId: 'shelter_management',
		title: 'จุดบริการสื่อสารและติดต่อญาติ',
		description:
			'มีระบบสื่อสารกลางที่สนับสนุนการค้นหา และติดต่อญาติและการประสานข้อมูลผู้พักพิงระหว่างศูนย์ โดยคำนึงถึงการคุ้มครองข้อมูลส่วนบุคคล',
		importance: 'mandatory'
	},
	{
		id: 'city_sec3_13',
		sectionId: 'shelter_management',
		title: 'การมีส่วนร่วม',
		description:
			'มีระบบการมีส่วนร่วมหลายระดับ ตั้งแต่ผู้พักพิงระดับชุมชน อปท. เมือง เพื่อร่วมวางแผน ประเมิน และพัฒนามาตรฐานการจัดการศูนย์พักพิง',
		importance: 'mandatory'
	}
] as const;

/**
 * Returns catalog items filtered by the chosen tier.
 */
export function getReadinessCatalogByTier(tier: ReadinessTier): readonly ReadinessCatalogItem[] {
	switch (tier) {
		case 'community':
			return COMMUNITY_CATALOG_ITEMS;
		case 'local_admin':
			return LOCAL_ADMIN_CATALOG_ITEMS;
		case 'city':
			return CITY_CATALOG_ITEMS;
	}
}
