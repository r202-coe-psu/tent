import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee, Medical, Screening } from '../../domain/people';
import EvacueeProfileHealthCard from './evacuee-profile-health-card.svelte';

// The master-data query hits CouchDB; serve a small fixed list per type instead.
vi.mock('$lib/features/master-data', async (importOriginal) => {
	const items = {
		chronic_disease: [{ code: 'diabetes', label_th: 'เบาหวาน', label_en: 'Diabetes' }],
		allergy: [{ code: 'penicillin', label_th: 'เพนิซิลลิน', label_en: 'Penicillin' }],
		vulnerable_group: [{ code: 'wheelchair', label_th: 'ใช้รถเข็น', label_en: 'Wheelchair user' }]
	} as Record<string, unknown[]>;
	return {
		...(await importOriginal<typeof import('$lib/features/master-data')>()),
		useMasterData: (type: () => string) => ({
			data: { items: items[type()] ?? [] },
			isPending: false
		})
	};
});

const evacuee: Evacuee = {
	_id: 'evacuee:test-123',
	_rev: '1-abc',
	type: 'evacuee',
	schema_v: 9,
	first_name: 'Anna',
	last_name: 'Schmidt',
	gender: 'female',
	age: 40,
	vulnerable_groups: ['wheelchair'],
	special_needs: ['Hearing aid'],
	current_stay: { status: 'arriving', zone: null, since: '2026-09-02T10:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'staff',
	household_id: null,
	shelter_code: 'SH001',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
} as Evacuee;

const medical: Medical = {
	_id: 'medical:test-123',
	_rev: '1-abc',
	type: 'medical',
	schema_v: 9,
	evacuee_id: 'evacuee:test-123',
	conditions: ['diabetes'],
	medications: ['Metformin'],
	allergies: ['penicillin'],
	track: 'fast_track',
	notes: 'Weekly check',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
} as Medical;

const screening: Screening = {
	_id: 'screening:test-123',
	_rev: '1-abc',
	type: 'screening',
	schema_v: 9,
	evacuee_id: 'evacuee:test-123',
	symptoms: ['dengue', 'measles'],
	track: 'fast_track',
	notes: 'Mild fever',
	screened_at: '2026-09-02T10:00:00.000Z',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
} as Screening;

function renderCard(
	language: 'th' | 'en',
	data: { evacuee: Evacuee; medical: Medical | null; screening: Screening | null } = {
		evacuee,
		medical,
		screening
	}
) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfileHealthCard, {
			props: { ...data, readonly: false, onOpenEdit: () => {} }
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfileHealthCard', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderCard('en');
		expect(body).toContain('Health &amp; vulnerability');
		expect(body).toContain('Edit health information');
		expect(body).toContain('Care track');
		expect(body).toContain('Should be isolated (surveillance symptoms present)');
		expect(body).toContain('Dengue fever');
		expect(body).toContain('Measles (fever with rash)');
		expect(body).toContain('Chronic conditions');
		expect(body).toContain('Diabetes');
		expect(body).toContain('Penicillin');
		expect(body).toContain('Wheelchair user');
		expect(body).toContain('Special needs');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('shows English empty states and no Thai text when the staff language is EN', () => {
		const body = renderCard('en', {
			evacuee: { ...evacuee, vulnerable_groups: [], special_needs: [] },
			medical: null,
			screening: null
		});
		expect(body).toContain('No infection risk');
		expect(body).toContain('No symptoms recorded');
		expect(body).toContain('No surveillance symptoms');
		expect(body).toContain('General (no vulnerable group)');
		expect(body).toContain('No special needs');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderCard('th');
		expect(body).toContain('แก้ไขข้อมูลสุขภาพ');
		expect(body).toContain('ควรแยกกักโรค (มีอาการเฝ้าระวัง)');
		expect(body).toContain('โรคประจำตัว:');
		expect(body).toContain('ไข้เลือดออก');
		expect(body).toContain('โรคหัด (ไข้ร่วมกับผื่น)');
		expect(body).toContain('เบาหวาน');
		expect(body).toContain('ใช้รถเข็น');
		expect(body).toContain('ความต้องการพิเศษ:');
	});
});
