import type { PetGroup } from '../../domain/people';

export type PetCardItem = {
	id: number;
	species: 'dog' | 'cat' | 'other';
	customSpecies: string;
	name: string;
	details: string;
	has_cage: boolean;
	image_url: string | null;
	previewUrl: string | null;
};

export function createPetCard(species: 'dog' | 'cat' | 'other', id: number): PetCardItem {
	return {
		id,
		species,
		customSpecies: '',
		name: '',
		details: '',
		has_cage: false,
		image_url: null,
		previewUrl: null
	};
}

/**
 * Expand each PetGroup by count into individual cards; parse notes for name
 * (`ชื่อ:`), customSpecies (for other), and remaining details.
 */
export function parseInitialPets(
	pets: PetGroup[],
	startId = 1
): { items: PetCardItem[]; nextId: number } {
	const result: PetCardItem[] = [];
	let nextId = startId;

	for (const p of pets ?? []) {
		const count = Math.max(1, Number(p.count) || 1);
		for (let i = 0; i < count; i++) {
			const notes = p.notes ?? '';
			const parts = notes
				.split('|')
				.map((s) => s.trim())
				.filter(Boolean);
			let customSpecies = '';
			let name = '';
			const detailsList: string[] = [];

			for (const part of parts) {
				if (part.startsWith('ชื่อ:')) {
					name = part.replace(/^ชื่อ:\s*/, '').trim();
				} else if (p.species === 'other' && !customSpecies) {
					customSpecies = part;
				} else {
					detailsList.push(part);
				}
			}

			result.push({
				id: nextId++,
				species: p.species,
				customSpecies: p.species === 'other' ? customSpecies || notes : '',
				name,
				details: detailsList.join(' | '),
				has_cage: p.has_cage ?? false,
				image_url: p.image_url ?? null,
				previewUrl: null
			});
		}
	}

	return { items: result, nextId };
}

/** Map pet cards back to PetGroup[] (same notes packing as the former form sync). */
export function syncPetsToHousehold(petItems: PetCardItem[]): PetGroup[] {
	return petItems.map((p) => {
		const notesParts: string[] = [];
		if (p.species === 'other' && p.customSpecies.trim()) {
			notesParts.push(p.customSpecies.trim());
		}
		if (p.name.trim()) {
			notesParts.push(`ชื่อ: ${p.name.trim()}`);
		}
		if (p.details.trim()) {
			notesParts.push(p.details.trim());
		}
		const notes =
			notesParts.length > 0
				? notesParts.join(' | ')
				: p.species === 'other'
					? p.customSpecies.trim()
					: undefined;
		return {
			species: p.species,
			count: 1,
			notes,
			has_cage: p.has_cage,
			image_url: p.image_url
		};
	});
}

/** Alias for {@link syncPetsToHousehold}. */
export const petItemsToGroups = syncPetsToHousehold;

export function getPetTitle(
	item: PetCardItem,
	petItems: PetCardItem[],
	labels: {
		dogTitle: string;
		catTitle: string;
		otherPetTitle: string;
		petIndexSuffix: string;
	}
): string {
	const sameSpecies = petItems.filter((p) => p.species === item.species);
	const indexInSpecies = sameSpecies.findIndex((p) => p.id === item.id) + 1;
	if (item.species === 'dog') {
		return `${labels.dogTitle} — ${labels.petIndexSuffix} ${indexInSpecies}`;
	}
	if (item.species === 'cat') {
		return `${labels.catTitle} — ${labels.petIndexSuffix} ${indexInSpecies}`;
	}
	const label = item.customSpecies.trim() ? item.customSpecies.trim() : labels.otherPetTitle;
	return `${label} — ${labels.petIndexSuffix} ${indexInSpecies}`;
}
