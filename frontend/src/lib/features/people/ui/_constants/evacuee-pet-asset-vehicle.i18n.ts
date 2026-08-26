export const EVACUEE_PET_ASSET_VEHICLE_I18N = {
	th: {
		pets: {
			title: '🐶 สัตว์เลี้ยงที่นำมาด้วย',
			btnAdd: 'เพิ่มสัตว์เลี้ยง',
			empty: 'ยังไม่มีสัตว์เลี้ยง — กด "เพิ่มสัตว์เลี้ยง" เพื่อเพิ่มรายการ',
			speciesLabel: 'ประเภท',
			countLabel: 'จำนวน (ตัว)',
			notesLabel: 'รายละเอียด / พันธุ์',
			notesPlaceholder: 'เช่น ชิสุ สีขาว',
			cageLabel: 'มีกรง/สายจูง',
			options: {
				dog: '🐶 สุนัข',
				cat: '🐱 แมว',
				bird: '🐦 นก',
				other: '🐾 อื่นๆ'
			}
		},
		vehicles: {
			title: '🚗 ยานพาหนะที่นำมาด้วย',
			btnAdd: 'เพิ่มยานพาหนะ',
			empty: 'ไม่มียานพาหนะ — กด "เพิ่มยานพาหนะ" เพื่อเพิ่มรายการ',
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
			title: '📦 ทรัพย์สินและสัมภาระสำคัญ',
			label: 'รายการสัมภาระ / ทรัพย์สินติดตัว',
			placeholder: 'เช่น กระเป๋าเดินทาง 2 ใบ, ถุงยังชีพ'
		},
		disclaimer: {
			title: 'ข้อตกลงและเงื่อนไขของศูนย์พักพิง',
			acknowledge: 'ฉันได้อ่านและยอมรับข้อตกลงและเงื่อนไขข้างต้น'
		},
		actions: {
			next: 'ถัดไป (จัดสรรพื้นที่) →',
			back: 'ย้อนกลับ'
		}
	},
	en: {
		pets: {
			title: '🐶 Pets Brought Along',
			btnAdd: 'Add Pet',
			empty: 'No pets added — click "Add Pet" to add an item',
			speciesLabel: 'Species',
			countLabel: 'Count',
			notesLabel: 'Details / Breed',
			notesPlaceholder: 'e.g. White Shih Tzu',
			cageLabel: 'Has cage / leash',
			options: {
				dog: '🐶 Dog',
				cat: '🐱 Cat',
				bird: '🐦 Bird',
				other: '🐾 Other'
			}
		},
		vehicles: {
			title: '🚗 Vehicles Brought Along',
			btnAdd: 'Add Vehicle',
			empty: 'No vehicles added — click "Add Vehicle" to add an item',
			typeLabel: 'Vehicle Type',
			plateLabel: 'License Plate (if any)',
			platePlaceholder: 'e.g. ABC 1234',
			options: {
				car: 'Car',
				motorcycle: 'Motorcycle',
				other: 'Other'
			}
		},
		assets: {
			title: '📦 Luggage & Valuables',
			label: 'Luggage / Personal Belongings Description',
			placeholder: 'e.g. 2 suitcases, emergency ration pack'
		},
		disclaimer: {
			title: 'Shelter Terms & Conditions',
			acknowledge: 'I have read and agree to the terms and conditions above'
		},
		actions: {
			next: 'Next (Zoning Allocation) →',
			back: 'Back'
		}
	}
} as const;

export type EvacueePetAssetVehicleI18n = typeof EVACUEE_PET_ASSET_VEHICLE_I18N;
