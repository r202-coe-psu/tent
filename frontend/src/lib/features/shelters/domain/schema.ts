import { z } from 'zod';

export const shelterStatusSchema = z.enum(['open', 'closed']);
export type ShelterStatus = z.infer<typeof shelterStatusSchema>;

export const shelterCapacitySchema = z.coerce.number().int().positive('Capacity must be > 0');

export const zoneSchema = z.object({
	code: z.string().trim().min(1, 'รหัสโซน (Zone ID) ต้องไม่ว่าง'),
	name: z.string().trim().min(1, 'ชื่อโซนต้องไม่ว่าง'),
	capacity: z.coerce.number().int().positive('ความจุของโซนต้องมากกว่า 0')
});
export type Zone = z.infer<typeof zoneSchema>;

export const itemSchema = z.object({
	item_id: z.string().trim().min(1, 'รหัสสิ่งของ (Item ID) ต้องไม่ว่าง'),
	name: z.string().trim().min(1, 'ชื่อสิ่งของบรรเทาทุกข์ต้องไม่ว่าง'),
	unit: z.string().trim().min(1, 'หน่วยนับต้องไม่ว่าง')
});
export type Item = z.infer<typeof itemSchema>;

export const ruleSchema = z.object({
	rule_id: z.string().trim().min(1, 'รหัสกฎ (Rule ID) ต้องไม่ว่าง'),
	name: z.string().trim().min(1, 'ชื่อเงื่อนไขต้องไม่ว่าง'),
	description: z.string().trim().min(1, 'คำอธิบายเงื่อนไขต้องไม่ว่าง')
});
export type Rule = z.infer<typeof ruleSchema>;

export const sopSchema = z.object({
	sop_id: z.string().trim().min(1, 'รหัสงาน SOP ต้องไม่ว่าง'),
	name: z.string().trim().min(1, 'หัวข้อภารกิจตรวจเช็คต้องไม่ว่าง'),
	description: z.string().trim().min(1, 'รายละเอียดขั้นตอนการดำเนินงานต้องไม่ว่าง')
});
export type Sop = z.infer<typeof sopSchema>;

export const createShelterSchema = z.object({
	code: z.string().trim().min(1, 'รหัสศูนย์ (ID) ต้องไม่ว่าง'),
	name: z.string().trim().min(1, 'ชื่อศูนย์พักพิงต้องไม่ว่าง'),
	capacity: shelterCapacitySchema,
	zones: z.array(zoneSchema).default([]),
	items: z.array(itemSchema).default([]),
	rules: z.array(ruleSchema).default([]),
	sops: z.array(sopSchema).default([])
});
export type CreateShelterInput = z.infer<typeof createShelterSchema>;

export const updateShelterSchema = z.object({
	code: z.string().trim().optional(),
	name: z.string().trim().min(1, 'ชื่อศูนย์พักพิงต้องไม่ว่าง'),
	capacity: shelterCapacitySchema,
	zones: z.array(zoneSchema).default([]),
	items: z.array(itemSchema).default([]),
	rules: z.array(ruleSchema).default([]),
	sops: z.array(sopSchema).default([])
});
export type UpdateShelterInput = z.infer<typeof updateShelterSchema>;
