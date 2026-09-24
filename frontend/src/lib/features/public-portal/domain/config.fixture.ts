import type { PublicConfigBody } from './config';

export const DEFAULT_PUBLIC_PORTAL_CONFIG: PublicConfigBody = {
	phone_number: '',
	line_oa_url: '',
	facebook_url: '',
	faqs: {
		public: [
			{
				id: 'c30b393c-29e8-4a3d-a583-d99a3cf9e34a',
				question: 'วิธีการลงทะเบียนขอเข้าพักศูนย์พักพิงต้องทำอย่างไร?',
				answer:
					'สามารถลงทะเบียนได้ 2 วิธี: 1) เดินทางมาลงทะเบียนด้วยตนเอง ณ จุดคัดกรองหน้าศูนย์พักพิงที่เปิดรับ หรือ 2) ลงทะเบียนล่วงหน้าผ่านระบบออนไลน์บนเว็บไซต์นี้ เพื่อให้เจ้าหน้าที่จัดสรรพื้นที่ เตียง อาหาร และการดูแลกลุ่มเปราะบางล่วงหน้า',
				question_en: 'How do evacuees register for shelter admission?',
				answer_en:
					'Registration can be completed either in person at the shelter screening desk or pre-registered online via this portal for advance preparation.',
				order: 0,
				is_published: true
			},
			{
				id: 'aa67cda9-a91a-4e25-b3c3-236319e03a43',
				question: 'ศูนย์พักพิงเปิดรับบริจาคสิ่งของอะไรบ้าง และส่งมอบได้ที่ไหน?',
				answer:
					'สามารถตรวจสอบรายการสิ่งของจำเป็นเร่งด่วนแบบเรียลไทม์ได้ที่หน้า "แจ้งบริจาคสิ่งของ" ซึ่งจะแสดงรายการที่ศูนย์กำลังขาดแคลนจริง เช่น น้ำดื่ม ข้าวสาร นมผง ผ้าอ้อมผู้ใหญ่ และนำมาส่งมอบได้ที่จุดรับบริจาคกลางของศูนย์พักพิง หรือนัดหมายเวลาส่งมอบผ่านระบบ',
				question_en: 'What items can be donated and where can they be dropped off?',
				answer_en:
					'Real-time requested supplies can be tracked on the donation page. Items can be dropped off at the central relief depot.',
				order: 1,
				is_published: true
			},
			{
				id: 'e6b05673-b95b-4082-9dec-795e977fee10',
				question: 'สามารถนำสัตว์เลี้ยงเข้ามาพักในศูนย์พักพิงได้หรือไม่?',
				answer:
					'ศูนย์พักพิงจัดเตรียมโซนดูแลสัตว์เลี้ยงเฉพาะแยกจากอาคารพักพิงของผู้ประสบภัย โดยขอความร่วมมือเจ้าของนำกรง สายจูง และอาหารสัตว์เลี้ยงมาด้วย เพื่อสุขอนามัยและความปลอดภัยของผู้พักพิงทุกคน',
				question_en: 'Are pets allowed in the evacuation center?',
				answer_en:
					'Designated pet zones are provided separately from human sleeping quarters. Owners are kindly requested to bring crates, leashes, and pet food.',
				order: 2,
				is_published: true
			},
			{
				id: '1fe16114-7187-4995-9db8-60ec542c1cf0',
				question: 'ค้นหาข้อมูลญาติหรือคนในครอบครัวที่อยู่ในศูนย์พักพิงอย่างไร?',
				answer:
					'สามารถใช้ระบบ "ค้นหาญาติในศูนย์พักพิง" บนหน้าแรก โดยระบุชื่อ-นามสกุล หรือเบอร์โทรศัพท์ ทั้งนี้ระบบแสดงเฉพาะข้อมูลยืนยันความปลอดภัยและการอยู่อาศัยภายใต้มาตรฐานการคุ้มครองข้อมูลส่วนบุคคล (PDPA)',
				question_en: 'How do I search for family members staying in shelters?',
				answer_en:
					'Use the Family Search feature on the home page. Search results display safety status under strict privacy safeguards.',
				order: 3,
				is_published: true
			},
			{
				id: '893b5d08-fecb-45f4-a37f-b65023b3d72e',
				question: 'หากเกิดเหตุฉุกเฉินหรือติดค้างในพื้นที่น้ำท่วมสูง ต้องติดต่อใคร?',
				answer:
					'ประสานสายด่วนกู้ชีพแพทย์ฉุกเฉิน 1669 หรือสายด่วนกรมป้องกันและบรรเทาสาธารณภัย (ปภ.) 1784 ได้ตลอด 24 ชั่วโมง หรือโทรสายตรงศูนย์ประสานงาน Smart Shelter ประจำพื้นที่',
				question_en: 'Who should I contact in a critical or life-threatening situation?',
				answer_en:
					'Contact Medical Emergency Hotline 1669 or DDPM Disaster Hotline 1784 immediately 24/7, or call the local Smart Shelter coordination line.',
				order: 4,
				is_published: true
			}
		],
		registration: [
			{
				id: '5e454675-5dae-4f29-b78c-6d7d709261b8',
				question: 'ต้องใช้เอกสารอะไรบ้างในการลงทะเบียนเข้าพัก?',
				answer:
					'ใช้บัตรประจำตัวประชาชนของผู้ประสบภัยหรือหัวหน้าครอบครัว หากไม่มีบัตรประชาชนหรือสูญหายไปกับน้ำท่วม สามารถใช้ใบขับขี่ บัตรคนพิการ หรือแจ้งข้อมูลส่วนบุคคลให้เจ้าหน้าที่ตรวจสอบและบันทึกประวัติเข้าสู่ระบบได้',
				question_en: 'What documents are required for shelter registration?',
				answer_en:
					'Thai National ID card or any government-issued ID. If lost during the disaster, shelter staff will verify and assist with manual registration.',
				order: 0,
				is_published: true
			},
			{
				id: '379d26b7-b44f-4235-ad2a-13eea2834fc6',
				question: 'สามารถลงทะเบียนล่วงหน้าแทนสมาชิกในครอบครัวได้หรือไม่?',
				answer:
					'สามารถลงทะเบียนแทนคนในครอบครัวหรือกลุ่มที่อพยพมาด้วยกันได้ โดยระบุจำนวนสมาชิก ข้อมูลเด็ก ผู้สูงอายุ หรือผู้มีโรคประจำตัว/ยาประจำ เพื่อให้ศูนย์จัดเตรียมพื้นที่และยาต่อเนื่องได้อย่างถูกต้อง',
				question_en: 'Can a family representative register for other family members?',
				answer_en:
					'Yes, family heads can register on behalf of dependents, especially vulnerable members requiring specialized medical care or food.',
				order: 1,
				is_published: true
			},
			{
				id: '8363a757-0036-4ca0-a1bf-eae2cc574aa8',
				question: 'การลงทะเบียนล่วงหน้าถือเป็นการยืนยันสิทธิ์เตียงทันทีหรือไม่?',
				answer:
					'การลงทะเบียนล่วงหน้าเป็นการแจ้งความประสงค์และสำรองคิวคัดกรอง การยืนยันสิทธิ์และจัดสรรจุดพักพิงจริงจะสมบูรณ์เมื่อเดินทางมารายงานตัวและผ่านจุดคัดกรอง ณ ศูนย์พักพิง',
				question_en: 'Does online pre-registration guarantee an immediate bed assignment?',
				answer_en:
					'Pre-registration reserves your screening slot. Actual bed allocation is finalized upon in-person check-in at the screening desk.',
				order: 2,
				is_published: true
			},
			{
				id: '4d2d8417-c4e6-4ac3-8229-06f14f1300bc',
				question: 'หากมีผู้ป่วยติดเตียงหรือผู้ใช้วีลแชร์ ต้องแจ้งในขั้นตอนใด?',
				answer:
					'กรุณาระบุในช่อง "กลุ่มเปราะบาง / ภาวะทางสุขภาพ" ในขั้นตอนการลงทะเบียน เพื่อให้ฝ่ายแพทย์และอาคารจัดพื้นที่พักชั้นล่าง ใกล้ห้องน้ำ และเตรียมอุปกรณ์พยาบาลล่วงหน้า',
				question_en: 'When should mobility-impaired or bedridden evacuees be declared?',
				answer_en:
					'Please select relevant options under the Vulnerable Groups section so staff can assign ground-floor, barrier-free accommodation.',
				order: 3,
				is_published: true
			}
		],
		volunteer: [
			{
				id: 'b1d4b33d-bc65-45c5-8e45-d8ac616fc669',
				question: 'คุณสมบัติของผู้ที่ต้องการสมัครเป็นอาสาสมัครมีอะไรบ้าง?',
				answer:
					'บุคคลทั่วไปที่มีอายุ 18 ปีขึ้นไป มีสุขภาพแข็งแรง และพร้อมปฏิบัติตามกฎความปลอดภัยของศูนย์พักพิง สำหรับงานวิชาชีพเฉพาะทาง เช่น แพทย์ พยาบาล หรือช่างเทคนิค ต้องมีใบประกอบวิชาชีพหรือหลักฐานที่เกี่ยวข้อง',
				question_en: 'What are the basic qualifications for volunteers?',
				answer_en:
					'General volunteers aged 18+ in good health. Specialized roles (doctors, nurses, technical operators) require professional certification.',
				order: 0,
				is_published: true
			},
			{
				id: '5ef35c15-c779-4ab4-a046-c0851e2ac4a6',
				question: 'มีฝ่ายและบทบาทหน้าที่ใดบ้างที่เปิดรับอาสาสมัคร?',
				answer:
					'เปิดรับหลายฝ่ายตามความถนัด ได้แก่ 1) ฝ่ายครัวกลางและแจกจ่ายอาหาร 2) ฝ่ายคลังพัสดุและจัดชุดถุงยังชีพ 3) ฝ่ายต้อนรับและคัดกรองผู้ประสบภัย 4) ฝ่ายขนย้ายและสนับสนุนกู้ภัย โดยปฏิบัติงานแบ่งเป็นกะ (เช้า / บ่าย / ดึก)',
				question_en: 'What roles and responsibilities are available for volunteers?',
				answer_en:
					'Roles include central kitchen, relief distribution, warehouse logistics, screening assistance, and field rescue support.',
				order: 1,
				is_published: true
			},
			{
				id: 'c11866ae-6466-4ea8-96e3-c5753cbcdb46',
				question: 'อาสาสมัครต้องเตรียมสิ่งของใดมาในวันปฏิบัติหน้าที่?',
				answer:
					'บัตรประชาชน ยาประจำตัว สวมเสื้อผ้าที่คล่องตัวและรองเท้าหุ้มส้นหรือบูทยาง ศูนย์พักพิงจะจัดเตรียมเสื้อกั๊กสะท้อนแสง ป้ายชื่อ อุปกรณ์คุ้มครองความปลอดภัย (PPE) และอาหารประจำกะให้',
				question_en: 'What should volunteers bring on their shift?',
				answer_en:
					'Bring personal ID, medication, and wear sturdy footwear. Safety vest, badge, PPE, and shift meals are provided by the center.',
				order: 2,
				is_published: true
			},
			{
				id: '59a4b8af-f337-4a14-9311-2fa27d4bebc9',
				question: 'หากต้องการเปลี่ยนหรือยกเลิกกะงานต้องทำอย่างไร?',
				answer:
					'กรุณาแจ้งผ่านระบบหรือติดต่อหัวหน้าฝ่ายอาสาสมัครล่วงหน้าอย่างน้อย 6 ชั่วโมง เพื่อให้ผู้ประสานงานสามารถจัดสรรอาสาสมัครท่านอื่นมาปฏิบัติหน้าที่ทดแทนได้อย่างต่อเนื่อง',
				question_en: 'How do I cancel or reschedule a volunteer shift?',
				answer_en:
					'Please notify via the volunteer portal or contact the coordinator at least 6 hours in advance so replacements can be arranged.',
				order: 3,
				is_published: true
			}
		]
	}
};
