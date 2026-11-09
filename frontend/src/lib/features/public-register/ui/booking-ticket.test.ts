import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import BookingTicketView from './booking-ticket.svelte';
import type { BookingTicket } from '../application/booking-store.svelte';

describe('BookingTicketView (#415 Verification)', () => {
	const sampleTicket: BookingTicket = {
		code: '01JABCDEF1234567890',
		shelter_code: 'SH01',
		shelter_name: 'ศูนย์พักพิงโรงเรียนทดสอบ',
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		member_count: 3,
		type: 'shelter_booking',
		status: 'pre_registered',
		booked_at: '2026-10-10T02:00:00Z'
	};

	it('does NOT render verifiedBtn (ยืนยันที่ศูนย์แล้ว / ลบใบลงทะเบียน)', () => {
		const result = render(BookingTicketView, {
			props: {
				ticket: sampleTicket,
				showSuccessHeader: false
			}
		});

		expect(result.body).not.toContain('ยืนยันที่ศูนย์แล้ว (ลบใบลงทะเบียน)');
		expect(result.body).not.toContain('Confirmed at shelter (remove slip)');
	});

	it('renders download options (PDF and PNG) and registrant details', () => {
		const result = render(BookingTicketView, {
			props: {
				ticket: sampleTicket,
				showSuccessHeader: false
			}
		});

		expect(result.body).toContain('ดาวน์โหลดใบลงทะเบียน (PDF)');
		expect(result.body).toContain('บันทึกเป็นรูปภาพ (PNG)');
		expect(result.body).toContain('สมชาย ใจดี');
		expect(result.body).toContain('ศูนย์พักพิงโรงเรียนทดสอบ');
	});

	describe('unassigned-queue ticket', () => {
		const unassignedTicket: BookingTicket = {
			code: '01JQUEUE1234567890',
			shelter_code: 'unassigned',
			shelter_name: '',
			first_name: 'Anna',
			last_name: 'Schmidt',
			member_count: 2,
			type: 'unassigned_queue',
			status: 'pre_registered',
			// Empty on purpose: ticket dates stay th-TH (CONVENTIONS §10), which would put Thai in the EN render.
			booked_at: ''
		};

		function renderUnassigned(language: 'th' | 'en') {
			const previous = langState.current;
			langState.current = language;
			try {
				return render(BookingTicketView, {
					props: { ticket: unassignedTicket, showSuccessHeader: false }
				}).body;
			} finally {
				langState.current = previous;
			}
		}

		it('shows the registration code with an English label and no Thai text when the language is EN', () => {
			const body = renderUnassigned('en');

			expect(body).toContain('Code: 01JQUEUE1234567890');
			expect(body).not.toMatch(/[฀-๿]/);
		});

		it('keeps the Thai code label when the language is TH', () => {
			expect(renderUnassigned('th')).toContain('รหัส: 01JQUEUE1234567890');
		});
	});
});
