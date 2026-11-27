// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import OverviewPhaseStrip from './overview-phase-strip.svelte';
import type { OverviewSummary } from '../domain/schemas';

const summary = {
	unassigned_members: 4,
	unassigned_registrations: 2,
	pre_registered_at_sites: 7,
	present_total: 10,
	forecast_total: 17,
	avg_present_pct: 50,
	avg_forecast_pct: 85,
	sites_by_status: {},
	checkouts_in_window: 0,
	sites_closed: 0,
	sites_closed_or_cancelled: 0,
	sites_open_with_present: 1,
	sites_total: 1,
	movement_window: 'today'
} as OverviewSummary;

let instance: ReturnType<typeof mount> | undefined;

function render() {
	instance = mount(OverviewPhaseStrip, { target: document.body, props: { summary } });
	flushSync();
	return document.body.textContent ?? '';
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	languageStore.setLanguage('th');
});

describe('OverviewPhaseStrip copy (#1503)', () => {
	it('uses plain Thai wording and explains which % is which', () => {
		languageStore.setLanguage('th');
		const text = render();
		expect(text).toContain('ลงทะเบียนล่วงหน้า (รอเข้าศูนย์)');
		expect(text).toContain('ยังไม่ได้เลือกศูนย์');
		expect(text).toContain('ลงทะเบียนล่วงหน้าที่ระบุศูนย์แล้ว');
		expect(text).toContain('ตอนนี้ 50% · คาดการณ์ 85%');
		expect(text).not.toMatch(/Pre-reg|ผูกศูนย์|พร้อมรับ/);
	});

	it('switches to English', () => {
		languageStore.setLanguage('en');
		const text = render();
		expect(text).toContain('Pre-registered (waiting to arrive)');
		expect(text).toContain('Now 50% · forecast 85%');
		expect(text).not.toMatch(/[฀-๿]/);
	});
});
