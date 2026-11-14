/** Vehicle type names and capacity wording, shared by the staff form, the map popup and the shelter page. */
export const VEHICLE_TYPE_I18N = {
	th: {
		motorcycle: 'รถจักรยานยนต์',
		car: 'รถยนต์ / รถกระบะ',
		truck: 'รถบรรทุก / รถขนาดใหญ่',
		boat: 'เรือ',
		unitVehicle: 'คัน',
		unitBoat: 'ลำ',
		upTo: 'รองรับสูงสุด',
		capacityUnset: 'ไม่ระบุจำนวน'
	},
	en: {
		motorcycle: 'Motorcycles',
		car: 'Cars / pickups',
		truck: 'Trucks / large vehicles',
		boat: 'Boats',
		unitVehicle: 'vehicles',
		unitBoat: 'boats',
		upTo: 'Up to',
		capacityUnset: 'Capacity not set'
	}
} as const;

type VehicleName = 'motorcycle' | 'car' | 'truck' | 'boat';

function words(lang: string | undefined) {
	return VEHICLE_TYPE_I18N[lang === 'en' ? 'en' : 'th'];
}

/** Display name of a vehicle type; an unknown type is shown as its code. */
export function vehicleLabel(type: string, lang?: string): string {
	return words(lang)[type as VehicleName] ?? type;
}

/** "Up to 30 vehicles" / "Capacity not set"; boats count in `ลำ`. */
export function vehicleCapacityText(
	type: string,
	max: number | null | undefined,
	lang?: string
): string {
	const w = words(lang);
	if (max == null) return w.capacityUnset;
	return `${w.upTo} ${max} ${type === 'boat' ? w.unitBoat : w.unitVehicle}`;
}
