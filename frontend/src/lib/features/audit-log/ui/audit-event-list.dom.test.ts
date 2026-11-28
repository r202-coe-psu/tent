// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AuditEventList from './audit-event-list.svelte';
import type { AuditEventView } from '../domain/audit-query';

const item: AuditEventView = {
	_id: 'audit_event:01',
	type: 'audit_event',
	schema_v: 1,
	occurred_at: '2026-11-17T03:00:00.000Z',
	created_at: '2026-11-17T03:00:00.000Z',
	updated_at: '2026-11-17T03:00:00.000Z',
	created_by: 'sm.user',
	actor: { name: 'sm.user', kind: 'user', display_name: 'สมศรี ใจงาม' },
	action: 'update',
	event: 'shelter.updated',
	entity: { type: 'shelter', id: 'SH001', label: 'ศูนย์ A' },
	shelter_code: 'SH001',
	changes: [{ field: 'capacity', from: 120, to: 150 }, { field: 'contact' }],
	reason: null,
	source: 'bff'
};

let instance: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('AuditEventList', () => {
	it('shows who did what to which record, and the changes on demand', () => {
		instance = mount(AuditEventList, { target: document.body, props: { items: [item] } });
		const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
		expect(text()).toContain('แก้ไขข้อมูลศูนย์');
		expect(text()).toContain('ศูนย์ A');
		expect(text()).toContain('สมศรี ใจงาม');
		expect(text()).not.toContain('120 → 150');

		document.body.querySelector<HTMLButtonElement>('button')!.click();
		flushSync();
		expect(text()).toContain('capacity: 120 → 150');
		expect(text()).toContain('contact: มีการแก้ไข');
	});

	it('shows a compaction notice when changes_unknown is true', () => {
		const compacted: AuditEventView = {
			...item,
			_id: 'audit_event:rev:compacted',
			changes: undefined,
			changes_unknown: true,
			source: 'worker_diff'
		};
		instance = mount(AuditEventList, { target: document.body, props: { items: [compacted] } });
		const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

		document.body.querySelector<HTMLButtonElement>('button')!.click();
		flushSync();
		expect(text()).toContain(
			'ไม่สามารถเปรียบเทียบรายละเอียดการแก้ไขได้ (ข้อมูลเวอร์ชันก่อนหน้าถูกบีบอัดแล้ว)'
		);
	});
});
