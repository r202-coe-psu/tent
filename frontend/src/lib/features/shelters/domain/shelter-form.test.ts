import { describe, expect, it } from 'vitest';
import {
	editsSubStorage,
	formMetaAfterSave,
	shelterFormSchema,
	shelterPatchInput,
	withoutFormMeta,
	type ShelterForm
} from './shelter-form';
import type { SubStorageItem } from './schema';

const point = { id: 'a', name: 'คลัง', types: ['general'] } as unknown as SubStorageItem;

function formData(over: Partial<ShelterForm> = {}): ShelterForm {
	return {
		name: 'ศูนย์ทดสอบ',
		capacity: 10,
		common_areas: { helipad: true, sub_storage: [{ ...point }] },
		_rev: '7-abc',
		_loaded_sub_storage: [{ ...point }],
		...over
	} as ShelterForm;
}

describe('shelterFormSchema (CR-230 A1)', () => {
	it('keeps the load bookkeeping through parsing, without validating the snapshot', () => {
		const shape = shelterFormSchema.shape;
		expect(shape._rev.safeParse('7-abc').success).toBe(true);
		expect(shape._loaded_sub_storage.safeParse([{ anything: 1 }]).success).toBe(true);
		expect(shape._loaded_sub_storage.safeParse(undefined).success).toBe(true);
	});
});

describe('withoutFormMeta', () => {
	it('strips _rev and _loaded_sub_storage and keeps every stored field', () => {
		const fields = withoutFormMeta(formData());
		expect(fields).not.toHaveProperty('_rev');
		expect(fields).not.toHaveProperty('_loaded_sub_storage');
		expect(fields.common_areas.sub_storage).toEqual([point]);
	});
});

describe('editsSubStorage', () => {
	it('is false when the points equal what the form loaded', () => {
		expect(editsSubStorage(formData())).toBe(false);
	});

	it('is true when a point was added, removed or changed', () => {
		const added = formData({
			common_areas: { sub_storage: [point, { ...point, id: 'b' }] } as ShelterForm['common_areas']
		});
		expect(editsSubStorage(added)).toBe(true);
		const removed = formData({
			common_areas: { sub_storage: [] } as unknown as ShelterForm['common_areas']
		});
		expect(editsSubStorage(removed)).toBe(true);
	});
});

describe('shelterPatchInput', () => {
	it('leaves sub_storage out when the form did not change it, keeping other common_areas fields', () => {
		const input = shelterPatchInput(formData());
		expect(input.common_areas).toEqual({ helipad: true });
		expect(input).not.toHaveProperty('_rev');
		expect(input).not.toHaveProperty('_loaded_sub_storage');
	});

	it('sends sub_storage when the form changed it', () => {
		const changed = { ...point, name: 'อื่น' } as SubStorageItem;
		const input = shelterPatchInput(
			formData({ common_areas: { sub_storage: [changed] } as ShelterForm['common_areas'] })
		);
		expect(input.common_areas.sub_storage).toEqual([changed]);
	});
});

describe('formMetaAfterSave', () => {
	it('moves _rev on and keeps the loaded points when the points were not edited', () => {
		const saved = formData();
		expect(formMetaAfterSave(saved, '8-def')).toEqual({
			_rev: '8-def',
			_loaded_sub_storage: [point]
		});
	});

	it('records the points it sent as the new loaded points, as a copy', () => {
		const renamed = { ...point, name: 'คลังใหม่' } as SubStorageItem;
		const saved = formData({
			common_areas: { sub_storage: [renamed] } as ShelterForm['common_areas']
		});
		const meta = formMetaAfterSave(saved, '8-def');
		expect(meta._loaded_sub_storage).toEqual([renamed]);
		expect(meta._loaded_sub_storage).not.toBe(saved.common_areas.sub_storage);
		// Same points as stored now, so the next save does not resend them.
		expect(editsSubStorage({ ...saved, ...meta })).toBe(false);
	});
});
