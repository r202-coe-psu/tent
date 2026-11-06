import { z } from 'zod';
import { shelterSchema, type Shelter, type SubStorageItem } from './schema';
import { omitUnchangedSubStorage, sameSubStorage } from './storage-points';

/**
 * The shelter edit form: the stored fields plus the `_rev` and points of the doc they were loaded
 * from (CR-230 A1). Both ride inside the form data, so anything that rewrites the fields (the query
 * reseed, superforms' own write-back after submit) rewrites them too, and a save can never send a
 * `_rev` newer than its content. `_loaded_sub_storage` is not validated: it is a snapshot, not input.
 */
export const shelterFormSchema = shelterSchema.extend({
	_rev: z.string().optional(),
	_loaded_sub_storage: z.array(z.any()).optional()
});
export type ShelterForm = z.infer<typeof shelterFormSchema>;

/** The stored fields only, without the form's load bookkeeping. */
export function withoutFormMeta(data: ShelterForm): Shelter {
	const fields: Partial<ShelterForm> = { ...data };
	delete fields._rev;
	delete fields._loaded_sub_storage;
	return fields as Shelter;
}

/** True when the form changed the points it loaded. */
export function editsSubStorage(data: ShelterForm): boolean {
	return !sameSubStorage(
		data.common_areas?.sub_storage,
		data._loaded_sub_storage as SubStorageItem[] | undefined
	);
}

/**
 * Edit-save PATCH body: the stored fields, without `sub_storage` when the form did not change it
 * (the server then keeps the stored points, CR-230 A1 FR-13).
 */
export function shelterPatchInput(data: ShelterForm): Shelter {
	const fields = withoutFormMeta(data);
	if (!fields.common_areas) return fields;
	return {
		...fields,
		common_areas: omitUnchangedSubStorage(
			fields.common_areas,
			data._loaded_sub_storage as SubStorageItem[] | undefined
		) as Shelter['common_areas']
	};
}

/**
 * The load bookkeeping after this form's own save of `saved` landed as `rev`: the new `_rev` and
 * the points that save left stored. When `sub_storage` was not sent the stored points stay the
 * ones already loaded (the form still shows those), so `_loaded_sub_storage` keeps its value.
 * Only these two fields change; whatever the user typed since is not touched.
 */
export function formMetaAfterSave(
	saved: ShelterForm,
	rev: string
): Pick<ShelterForm, '_rev' | '_loaded_sub_storage'> {
	return {
		_rev: rev,
		_loaded_sub_storage: editsSubStorage(saved)
			? structuredClone(saved.common_areas?.sub_storage ?? [])
			: saved._loaded_sub_storage
	};
}
