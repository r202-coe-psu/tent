export const EVACUEE_PET_ASSET_VEHICLE_I18N = {
	th: {
		pets: {
			title: 'สัตว์เลี้ยงที่นำมาด้วย',
			hasPets: 'มีสัตว์เลี้ยงมาด้วย',
			hasPetsNo: 'ไม่มีสัตว์เลี้ยง',
			speciesLabel: 'ประเภท',
			countLabel: 'จำนวน',
			detailsTitle: 'รายละเอียดแต่ละตัว',
			nameLabel: 'ชื่อ / ลักษณะ',
			namePlaceholder: 'เช่น ขาว, ชิสุ',
			conditionLabel: 'สภาพ / หมายเหตุ',
			conditionPlaceholder: 'เช่น ขาเจ็บ, ต้องให้ยา, กลัวเสียงดัง',
			cageLabel: 'มีกรงหรือสายจูง',
			petNumber: (n: number) => `ตัวที่ ${n}`,
			options: {
				dog: 'สุนัข',
				cat: 'แมว',
				bird: 'นก',
				other: 'อื่นๆ'
			}
		},
		vehicles: {
			title: 'ยานพาหนะที่นำมาด้วย',
			hasVehicles: 'มียานพาหนะ',
			hasVehiclesNo: 'ไม่มียานพาหนะ',
			btnAdd: 'เพิ่มคัน',
			typeLabel: 'ประเภท',
			plateLabel: 'ทะเบียนรถ (ถ้ามี)',
			platePlaceholder: 'เช่น กข 1234 สงขลา',
			options: {
				car: 'รถยนต์',
				motorcycle: 'จักรยานยนต์',
				other: 'อื่นๆ'
			}
		},
		assets: {
			title: 'ทรัพย์สินและสัมภาระสำคัญ',
			hasAssets: 'มีทรัพย์สิน/สัมภาระสำคัญ',
			hasAssetsNo: 'ไม่มี / ข้าม',
			label: 'รายการสัมภาระ / ทรัพย์สินติดตัว',
			placeholder: 'เช่น กระเป๋าเดินทาง 2 ใบ, ถุงยังชีพ'
		},
		disclaimer: {
			title: 'ข้อตกลงและเงื่อนไขของศูนย์พักพิง',
			acknowledge: 'ฉันได้อ่านและยอมรับข้อตกลงและเงื่อนไขข้างต้น'
		},
		actions: {
			next: 'ถัดไป (จัดสรรพื้นที่)',
			back: 'ย้อนกลับ'
		}
	},
	en: {
		pets: {
			title: 'Pets Brought Along',
			hasPets: 'Bringing pets',
			hasPetsNo: 'No pets',
			speciesLabel: 'Species',
			countLabel: 'Count',
			detailsTitle: 'Details per animal',
			nameLabel: 'Name / Description',
			namePlaceholder: 'e.g. White, Shih Tzu',
			conditionLabel: 'Condition / Notes',
			conditionPlaceholder: 'e.g. injured leg, needs medication',
			cageLabel: 'Has cage / leash',
			petNumber: (n: number) => `Animal ${n}`,
			options: {
				dog: 'Dog',
				cat: 'Cat',
				bird: 'Bird',
				other: 'Other'
			}
		},
		vehicles: {
			title: 'Vehicles Brought Along',
			hasVehicles: 'Bringing vehicles',
			hasVehiclesNo: 'No vehicles',
			btnAdd: 'Add vehicle',
			typeLabel: 'Type',
			plateLabel: 'License plate (if any)',
			platePlaceholder: 'e.g. ABC 1234',
			options: {
				car: 'Car',
				motorcycle: 'Motorcycle',
				other: 'Other'
			}
		},
		assets: {
			title: 'Luggage & Valuables',
			hasAssets: 'Has luggage / valuables',
			hasAssetsNo: 'None / skip',
			label: 'Luggage / belongings description',
			placeholder: 'e.g. 2 suitcases, emergency ration pack'
		},
		disclaimer: {
			title: 'Shelter Terms & Conditions',
			acknowledge: 'I have read and agree to the terms and conditions above'
		},
		actions: {
			next: 'Next (Zoning)',
			back: 'Back'
		}
	}
} as const;

export type EvacueePetAssetVehicleI18n = typeof EVACUEE_PET_ASSET_VEHICLE_I18N;
