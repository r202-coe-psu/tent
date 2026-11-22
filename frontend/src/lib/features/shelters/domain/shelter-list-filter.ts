import { isShelterPublicVisible } from './schema';

export type ShelterListFilter = {
	/** `'all'` keeps every site kind. */
	siteKind: string;
	/** Drop shelters that are not publicly visible (hidden or cancelled). */
	hideHidden: boolean;
	query: string;
};

type Filterable = {
	site_kind?: string | null;
	name?: string | null;
	code?: string | null;
	province?: string | null;
	district?: string | null;
	subdistrict?: string | null;
	community?: string | null;
};

/** Management-list filter: site kind, optional "hide non-public", then free-text search. */
export function filterShelterList<T extends Filterable>(
	shelters: readonly T[],
	{ siteKind, hideHidden, query }: ShelterListFilter
): T[] {
	const q = query.trim().toLowerCase();
	return shelters.filter((shelter) => {
		if (siteKind !== 'all' && shelter.site_kind !== siteKind) return false;
		if (hideHidden && !isShelterPublicVisible(shelter)) return false;
		if (!q) return true;
		return [
			shelter.name,
			shelter.code,
			shelter.province,
			shelter.district,
			shelter.subdistrict,
			shelter.community
		].some((field) => field?.toLowerCase().includes(q));
	});
}
