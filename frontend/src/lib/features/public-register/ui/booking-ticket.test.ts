import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
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
});
