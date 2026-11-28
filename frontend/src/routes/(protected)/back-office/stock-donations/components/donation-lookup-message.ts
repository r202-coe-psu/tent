/**
 * Thai toast for a failed booking lookup. The API answers in English and staff read Thai;
 * a 403 is a booking of another shelter, which retrying never fixes.
 */
export function donationLookupFailedMessage(status: number, query: string): string {
	if (status === 404) return `ไม่พบใบจองบริจาค “${query}” — ตรวจรหัสอีกครั้ง`;
	if (status === 403) return `ใบจอง “${query}” เป็นของศูนย์อื่น — รับเข้าที่ศูนย์นี้ไม่ได้`;
	return 'ตรวจสอบใบจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}
