import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import RegisteredViaBadge, { REGISTERED_VIA_BADGE_STYLES } from './registered-via-badge.svelte';

describe('RegisteredViaBadge', () => {
	it('defines styles for standard registration channels', () => {
		expect(REGISTERED_VIA_BADGE_STYLES.kiosk.label).toBe('ตู้ Kiosk');
		expect(REGISTERED_VIA_BADGE_STYLES.web.label).toBe('ออนไลน์ Web');
		expect(REGISTERED_VIA_BADGE_STYLES.staff.label).toBe('โต๊ะเจ้าหน้าที่');
		expect(REGISTERED_VIA_BADGE_STYLES.backoffice.label).toBe('Backoffice');
	});

	it('renders kiosk badge when via is kiosk', () => {
		const result = render(RegisteredViaBadge, {
			props: { via: 'kiosk' }
		});
		expect(result.body).toContain('ตู้ Kiosk');
		expect(result.body).toContain('bg-amber-50');
	});

	it('renders web badge when via is web', () => {
		const result = render(RegisteredViaBadge, {
			props: { via: 'web' }
		});
		expect(result.body).toContain('ออนไลน์ Web');
		expect(result.body).toContain('bg-sky-50');
	});

	it('infers kiosk badge when hasCardSnapshot is true even if via is omitted', () => {
		const result = render(RegisteredViaBadge, {
			props: { via: null, hasCardSnapshot: true }
		});
		expect(result.body).toContain('ตู้ Kiosk');
		expect(result.body).toContain('bg-amber-50');
	});

	it('renders staff badge by default when via is omitted and no card snapshot', () => {
		const result = render(RegisteredViaBadge, {
			props: {}
		});
		expect(result.body).toContain('โต๊ะเจ้าหน้าที่');
		expect(result.body).toContain('bg-slate-50');
	});

	it('renders custom label when provided', () => {
		const result = render(RegisteredViaBadge, {
			props: { via: 'kiosk', customLabel: 'Fast-Track Kiosk' }
		});
		expect(result.body).toContain('Fast-Track Kiosk');
	});
});
