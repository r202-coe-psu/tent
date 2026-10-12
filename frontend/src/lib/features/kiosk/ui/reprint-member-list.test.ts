import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { KioskEvacueeSummary } from '../data/kiosk-check-in.api';
import ReprintMemberList from './reprint-member-list.svelte';

function member(id: string, status: string, selectable: boolean): KioskEvacueeSummary {
	return {
		evacuee_id: id,
		first_name: `ชื่อ${id}`,
		last_name: 'ส****',
		gender: null,
		age: null,
		status,
		is_primary: false,
		selectable
	};
}

function html(members: KioskEvacueeSummary[]): string {
	return render(ReprintMemberList, {
		props: {
			members,
			selectedIds: [],
			allSelected: false,
			ontoggle: () => {},
			ontoggleall: () => {}
		}
	}).body.replace(/<!--[^]*?-->/g, '');
}

describe('ReprintMemberList', () => {
	it('tells a pre-registered member to use the card or ThaiD', () => {
		const body = html([member('EV1', 'active', true), member('EV2', 'pre_registered', false)]);

		expect(body).toContain('ยังไม่ได้ลงทะเบียน — ใช้บัตรประชาชนหรือ ThaiD');
		expect(body).not.toContain('ออกนอกศูนย์ชั่วคราว — พิมพ์ QR ไม่ได้');
	});

	it('tells a member on temporary leave a QR cannot be printed', () => {
		const body = html([member('EV1', 'active', true), member('EV2', 'temporary_leave', false)]);

		expect(body).toContain('ออกนอกศูนย์ชั่วคราว — พิมพ์ QR ไม่ได้');
		expect(body).not.toContain('ยังไม่ได้ลงทะเบียน — ใช้บัตรประชาชนหรือ ThaiD');
	});
});
