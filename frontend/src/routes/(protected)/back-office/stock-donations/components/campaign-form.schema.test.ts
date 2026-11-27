import { describe, expect, it } from 'vitest';
import {
	CAMPAIGN_FORM_MESSAGES as M,
	createCampaignFormSchema,
	editCampaignFormSchema,
	isTargetBelowPledged,
	type CampaignCatalogItem
} from './campaign-form.schema';

const catalog: Record<string, CampaignCatalogItem> = {
	rice: { unit: 'kg', unitCode: 'kg' },
	legacy: { unit: 'KG', unitCode: 'kg' },
	nounit: { unit: '', unitCode: null },
	weird: { unit: 'ลัง', unitCode: null }
};

const create = (pointReady = true) =>
	createCampaignFormSchema({ lookupItem: (id) => catalog[id], pointReady: () => pointReady });

const validCreate = {
	itemId: 'rice',
	target: '100',
	urgency: 'critical',
	dropOffPointId: '',
	description: 'ใช้ทำอาหาร'
};

/** First message per field path, so a test reads "field -> message". */
function messages(result: {
	success: boolean;
	error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
	const out: Record<string, string[]> = {};
	for (const issue of result.error?.issues ?? []) {
		(out[issue.path.join('.')] ??= []).push(issue.message);
	}
	return out;
}

describe('createCampaignFormSchema', () => {
	it('accepts a complete form', () => {
		expect(create().safeParse(validCreate).success).toBe(true);
	});

	it('reports every invalid field at once, one message each', () => {
		const result = create(false).safeParse({
			itemId: '',
			target: '',
			urgency: 'critical',
			dropOffPointId: '',
			description: '   '
		});
		expect(messages(result)).toEqual({
			itemId: [M.item],
			target: [M.targetMissing],
			dropOffPointId: [M.point],
			description: [M.description]
		});
	});

	it('refuses an item id the catalog does not have', () => {
		expect(messages(create().safeParse({ ...validCreate, itemId: 'ghost' }))).toEqual({
			itemId: [M.item]
		});
	});

	it('refuses a catalog row with no base unit', () => {
		expect(messages(create().safeParse({ ...validCreate, itemId: 'nounit' }))).toEqual({
			itemId: [M.itemNoUnit]
		});
	});

	it('names a unit the UOM master does not know', () => {
		expect(messages(create().safeParse({ ...validCreate, itemId: 'weird' }))).toEqual({
			itemId: [M.itemUnknownUnit('ลัง')]
		});
	});

	it('accepts a legacy unit label the UOM master resolves', () => {
		expect(create().safeParse({ ...validCreate, itemId: 'legacy' }).success).toBe(true);
	});

	it.each([
		['0', M.targetNotPositive],
		['-5', M.targetNotPositive],
		['abc', M.targetNotPositive],
		['  ', M.targetMissing]
	])('rejects target %j', (target, message) => {
		expect(messages(create().safeParse({ ...validCreate, target }))).toEqual({ target: [message] });
	});

	it('accepts a decimal target', () => {
		expect(create().safeParse({ ...validCreate, target: '2.5' }).success).toBe(true);
	});

	it('passes the chosen point to the env check', () => {
		const seen: string[] = [];
		const schema = createCampaignFormSchema({
			lookupItem: (id) => catalog[id],
			pointReady: (chosen) => {
				seen.push(chosen);
				return chosen === 'p-gym';
			}
		});
		expect(schema.safeParse({ ...validCreate, dropOffPointId: 'p-gym' }).success).toBe(true);
		expect(messages(schema.safeParse({ ...validCreate, dropOffPointId: '' }))).toEqual({
			dropOffPointId: [M.point]
		});
		expect(seen).toEqual(['p-gym', '']);
	});

	it('rejects an unknown urgency', () => {
		expect(create().safeParse({ ...validCreate, urgency: 'urgent' }).success).toBe(false);
	});
});

describe('editCampaignFormSchema', () => {
	let unit = 'kg';
	const edit = (pledged = '40') =>
		editCampaignFormSchema({ pledged, unitLabel: () => unit, pointReady: () => true });
	const valid = {
		title: 'ข้าวสาร',
		category: 'อื่นๆ',
		target: '100',
		urgency: 'normal',
		dropOffPointId: '',
		description: ''
	};

	it('accepts a complete form, with the details left empty', () => {
		expect(edit().safeParse(valid).success).toBe(true);
	});

	it('requires a title', () => {
		expect(messages(edit().safeParse({ ...valid, title: '  ' }))).toEqual({
			title: [M.title]
		});
	});

	it('allows lowering the target to exactly the pledged figure', () => {
		expect(edit('40').safeParse({ ...valid, target: '40' }).success).toBe(true);
	});

	it('refuses a target below the pledged figure and names the unit at validation time', () => {
		expect(messages(edit('40').safeParse({ ...valid, target: '39.5' }))).toEqual({
			target: [M.belowPledged('40', 'kg')]
		});
		unit = 'ถุง';
		expect(messages(edit('40').safeParse({ ...valid, target: '10' }))).toEqual({
			target: [M.belowPledged('40', 'ถุง')]
		});
	});

	it('reports a missing target before the pledged rule', () => {
		expect(messages(edit('40').safeParse({ ...valid, target: '' }))).toEqual({
			target: [M.targetMissing]
		});
		expect(messages(edit('40').safeParse({ ...valid, target: '0' }))).toEqual({
			target: [M.targetNotPositive]
		});
	});
});

describe('isTargetBelowPledged', () => {
	it('is only true for a valid target under the pledged figure', () => {
		expect(isTargetBelowPledged('10', '40')).toBe(true);
		expect(isTargetBelowPledged('40', '40')).toBe(false);
		expect(isTargetBelowPledged('', '40')).toBe(false);
		expect(isTargetBelowPledged('0', '40')).toBe(false);
	});
});
