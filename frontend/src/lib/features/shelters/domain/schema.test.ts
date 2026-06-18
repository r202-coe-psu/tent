import { describe, it, expect } from 'vitest';
import {
	createShelterSchema,
	updateShelterSchema,
	shelterCapacitySchema,
	shelterStatusSchema,
	zoneSchema,
	itemSchema,
	ruleSchema,
	sopSchema
} from './schema';

describe('shelterCapacitySchema', () => {
	it('accepts positive integers', () => {
		expect(shelterCapacitySchema.parse(100)).toBe(100);
		expect(shelterCapacitySchema.parse('250')).toBe(250);
	});

	it('rejects zero', () => {
		expect(() => shelterCapacitySchema.parse(0)).toThrow();
	});

	it('rejects negative', () => {
		expect(() => shelterCapacitySchema.parse(-1)).toThrow();
	});

	it('rejects non-integer', () => {
		expect(() => shelterCapacitySchema.parse(1.5)).toThrow();
	});
});

describe('shelterStatusSchema', () => {
	it('accepts open and closed', () => {
		expect(shelterStatusSchema.parse('open')).toBe('open');
		expect(shelterStatusSchema.parse('closed')).toBe('closed');
	});

	it('rejects active', () => {
		expect(() => shelterStatusSchema.parse('active')).toThrow();
	});
});

describe('zoneSchema', () => {
	it('validates a valid zone', () => {
		const zone = zoneSchema.parse({ code: 'Z1', name: 'Zone 1', capacity: 100 });
		expect(zone).toEqual({ code: 'Z1', name: 'Zone 1', capacity: 100 });
	});

	it('rejects empty code', () => {
		expect(() => zoneSchema.parse({ code: '', name: 'Zone 1', capacity: 100 })).toThrow();
	});

	it('rejects empty name', () => {
		expect(() => zoneSchema.parse({ code: 'Z1', name: '', capacity: 100 })).toThrow();
	});
});

describe('itemSchema', () => {
	it('validates a valid item', () => {
		const item = itemSchema.parse({ item_id: 'item-water', name: 'Water Pack', unit: 'pack' });
		expect(item).toEqual({ item_id: 'item-water', name: 'Water Pack', unit: 'pack' });
	});
});

describe('ruleSchema', () => {
	it('validates a valid rule', () => {
		const rule = ruleSchema.parse({
			rule_id: 'rule-elderly',
			name: 'Elderly',
			description: 'Over 60 years old'
		});
		expect(rule).toEqual({
			rule_id: 'rule-elderly',
			name: 'Elderly',
			description: 'Over 60 years old'
		});
	});
});

describe('sopSchema', () => {
	it('validates a valid sop', () => {
		const sop = sopSchema.parse({
			sop_id: 'sop-med',
			name: 'Check medical',
			description: 'Check elderly every morning'
		});
		expect(sop).toEqual({
			sop_id: 'sop-med',
			name: 'Check medical',
			description: 'Check elderly every morning'
		});
	});
});

describe('createShelterSchema', () => {
	it('validates a valid input with nested data', () => {
		const result = createShelterSchema.parse({
			code: 'shelter-hatyai',
			name: 'Main Shelter',
			capacity: 250,
			zones: [{ code: 'Z1', name: 'Zone 1', capacity: 100 }],
			items: [{ item_id: 'item-water', name: 'Water', unit: 'pack' }],
			rules: [],
			sops: []
		});
		expect(result.code).toBe('shelter-hatyai');
		expect(result.zones).toHaveLength(1);
	});

	it('rejects missing code', () => {
		expect(() => createShelterSchema.parse({ name: 'Main Shelter', capacity: 250 })).toThrow();
	});
});

describe('updateShelterSchema', () => {
	it('validates a valid input', () => {
		const result = updateShelterSchema.parse({
			name: 'Updated Shelter',
			capacity: 300,
			zones: [],
			items: [],
			rules: [],
			sops: []
		});
		expect(result.name).toBe('Updated Shelter');
	});
});
