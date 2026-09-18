export const UOM_LABELS: Readonly<Record<string, string>> = {
	piece: 'ชิ้น',
	pcs: 'ชิ้น',
	pc: 'ชิ้น',
	unit: 'หน่วย',
	kg: 'กิโลกรัม',
	g: 'กรัม',
	gram: 'กรัม',
	mg: 'มิลลิกรัม',
	mcg: 'ไมโครกรัม',
	l: 'ลิตร',
	litre: 'ลิตร',
	liter: 'ลิตร',
	ml: 'มิลลิลิตร',
	kcal: 'กิโลแคลอรี',
	bottle: 'ขวด',
	can: 'กระป๋อง',
	bar: 'ก้อน',
	tablet: 'เม็ด',
	pack: 'แพ็ค',
	bag: 'ถุง',
	box: 'กล่อง',
	carton: 'ลัง',
	sachet: 'ซอง',
	set: 'ชุด',
	pair: 'คู่',
	roll: 'ม้วน',
	sheet: 'แผ่น'
};

export function formatUom(code: string | null | undefined): string {
	const raw = (code ?? '').trim();
	if (!raw) return '';
	return UOM_LABELS[raw.toLowerCase()] ?? raw;
}
