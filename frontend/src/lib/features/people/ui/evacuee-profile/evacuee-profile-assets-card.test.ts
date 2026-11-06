import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Household } from '../../domain/people';
import EvacueeProfileAssetsCard from './evacuee-profile-assets-card.svelte';

const household: Household = {
	_id: 'household:test-123',
	_rev: '1-abc',
	type: 'household',
	schema_v: 9,
	label: 'Schmidt family',
	head_evacuee_id: null,
	status: 'active',
	checkout_destination: null,
	municipality_zone: null,
	community: null,
	pets: [
		{ species: 'dog', count: 1, has_cage: true, notes: 'Friendly' },
		{ species: 'other', count: 1 }
	],
	assets: { description: 'Two suitcases', image_url: null },
	vehicles: [
		{ type: 'car', license_plate: 'AB 1234' },
		{ type: 'motorcycle', license_plate: null },
		{ type: 'other', license_plate: null }
	],
	address_no: null,
	village_no: null,
	subdistrict: null,
	district: null,
	province: null,
	postal_code: null,
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
};

function renderCard(language: 'th' | 'en', value: Household | null = household) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfileAssetsCard, {
			props: { household: value, readonly: false, onOpenAssetModal: () => {} }
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfileAssetsCard', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderCard('en');
		expect(body).toContain('Belongings brought');
		expect(body).toContain('Vehicles');
		expect(body).toContain('Car');
		expect(body).toContain('Motorcycle');
		expect(body).toContain('Plate: AB 1234');
		expect(body).toContain('Pets');
		expect(body).toContain('Dog');
		expect(body).toContain('Has a cage');
		expect(body).toContain('Luggage / valuables');
		expect(body).toContain('Edit belongings, vehicles and pets');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('shows English empty states and no Thai text when the staff language is EN', () => {
		expect(renderCard('en', null)).toContain('No household data to show belongings for yet');
		expect(renderCard('en', { ...household, pets: [], vehicles: [], assets: null })).toContain(
			'No items'
		);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderCard('th');
		expect(body).toContain('สิ่งที่นำมาด้วย');
		expect(body).toContain('ยานพาหนะ');
		expect(body).toContain('รถยนต์');
		expect(body).toContain('จักรยานยนต์');
		expect(body).toContain('ทะเบียน: AB 1234');
		expect(body).toContain('สัตว์เลี้ยง');
		expect(body).toContain('สุนัข');
		expect(body).toContain('มีกรง');
		expect(body).toContain('สัมภาระ / สิ่งของมีค่า');
		expect(body).toContain('แก้ไขทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง');
	});
});
