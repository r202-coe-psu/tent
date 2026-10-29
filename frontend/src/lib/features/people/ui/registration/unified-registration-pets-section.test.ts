import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { PETS_MAX_COUNT } from '../../domain/people';
import UnifiedRegistrationPetsSection from './unified-registration-pets-section.svelte';
import { createPetCard } from './unified-registration-pets';

const MAX_REACHED = `บันทึกสัตว์เลี้ยงได้สูงสุด ${PETS_MAX_COUNT} ตัวต่อครอบครัว`;

function renderSection(existingPets: { species: string; count?: number }[], typedRows: number) {
	return render(UnifiedRegistrationPetsSection, {
		props: {
			petItems: Array.from({ length: typedRows }, (_, i) => createPetCard('cat', i + 1)),
			existingPets
		}
	}).body;
}

describe('UnifiedRegistrationPetsSection pet cap (CR-148)', () => {
	it('still has room while the household and the form together stay under the cap', () => {
		expect(renderSection([{ species: 'dog', count: 8 }], 1)).not.toContain(MAX_REACHED);
	});

	it('is full once the pets already on record plus the typed rows reach the cap', () => {
		expect(renderSection([{ species: 'dog', count: 9 }], 1)).toContain(MAX_REACHED);
	});

	it('counts the animals in a row, not the rows', () => {
		expect(renderSection([{ species: 'dog', count: 2 }], 1)).not.toContain(MAX_REACHED);
		expect(renderSection([{ species: 'dog', count: 2 }], 8)).toContain(MAX_REACHED);
	});

	it('treats a row with no usable count as one animal', () => {
		expect(renderSection([{ species: 'dog' }], 9)).toContain(MAX_REACHED);
	});

	it('still fills up on typed rows alone when the household has none', () => {
		expect(renderSection([], PETS_MAX_COUNT - 1)).not.toContain(MAX_REACHED);
		expect(renderSection([], PETS_MAX_COUNT)).toContain(MAX_REACHED);
	});
});
