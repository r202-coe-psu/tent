import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import QRCode from 'qrcode';
import EvacueeHandoverSlipModal, {
	buildScreeningDeepLink
} from './evacuee-handover-slip-modal.svelte';
import type { Evacuee } from '../domain/people';

describe('EvacueeHandoverSlipModal (Station 1 Handover QR Slip)', () => {
	const mockEvacuee: Evacuee = {
		_id: 'evacuee:test-123',
		_rev: '1-abc',
		type: 'evacuee',
		schema_v: 9,
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		nickname: 'ชาย',
		gender: 'male',
		phone: '0812345678',
		person_id: {
			cardType: 'national_id',
			number: '1100200300401'
		},
		country: 'THAILAND',
		vulnerable_groups: [],
		special_needs: ['ใช้วีลแชร์', 'ผู้ป่วยติดเตียง'],
		current_stay: {
			status: 'arriving',
			zone: null,
			since: '2026-09-02T10:00:00.000Z'
		},
		privacy: { search_excluded: false },
		registered_via: 'staff',
		household_id: null,
		shelter_code: 'SH001',
		created_at: '2026-09-02T10:00:00.000Z',
		created_by: 'staff-1',
		updated_at: '2026-09-02T10:00:00.000Z'
	};

	it('builds path-only deep link /onsite/medical-screening/{id} and generates valid QR data URL', async () => {
		const deepLink = buildScreeningDeepLink(mockEvacuee._id);
		expect(deepLink).toBe('/onsite/medical-screening/evacuee:test-123');

		// Verify QRCode library can process this link to a data URL
		const qrDataUrl = await QRCode.toDataURL(deepLink, { width: 320 });
		expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
	});

	it('displays evacuee full name, masked citizen ID, phone number, special needs, and EWAR tags', () => {
		const result = render(EvacueeHandoverSlipModal, {
			props: {
				show: true,
				evacuee: mockEvacuee,
				symptoms: ['fever', 'cough'],
				onClose: () => {}
			}
		});

		expect(result.body).toContain('สมชาย');
		expect(result.body).toContain('ใจดี');
		expect(result.body).toContain('0812345678');
		// Masked national id (e.g. 110***401)
		expect(result.body).toContain('110***401');
		// Special needs badges
		expect(result.body).toContain('ใช้วีลแชร์');
		expect(result.body).toContain('ผู้ป่วยติดเตียง');
		// EWAR symptoms
		expect(result.body).toMatch(/ไข้|fever/i);
		// Deep link displayed on slip
		expect(result.body).toContain('/onsite/medical-screening/evacuee:test-123');
	});

	it('provides a Print action and a Done / Next Registration action', () => {
		const result = render(EvacueeHandoverSlipModal, {
			props: {
				show: true,
				evacuee: mockEvacuee,
				onClose: () => {}
			}
		});

		// Done / Next Registration button label
		expect(result.body).toMatch(/เสร็จสิ้น|ถัดไป|Done|Next Registration/i);
		// Print button label
		expect(result.body).toMatch(/พิมพ์|Print/i);
	});

	it('does not render modal content when show is false', () => {
		const result = render(EvacueeHandoverSlipModal, {
			props: {
				show: false,
				evacuee: mockEvacuee,
				onClose: () => {}
			}
		});

		expect(result.body).not.toContain('สมชาย ใจดี');
		expect(result.body).not.toContain('STATION 1');
	});
});
