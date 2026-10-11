import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import CircleAlert from '@lucide/svelte/icons/circle-alert';
import KioskNoticePanel from './kiosk-notice-panel.svelte';

function html(...args: Parameters<typeof render<typeof KioskNoticePanel>>): string {
	return render(...args).body.replace(/<!--[^]*?-->/g, '');
}

describe('KioskNoticePanel', () => {
	it('titles the card with an h2 under the page heading by default', () => {
		const body = html(KioskNoticePanel, {
			props: { tone: 'warning', icon: CircleAlert, title: 'ค้นหาไม่สำเร็จ', role: 'alert' }
		});

		expect(body).toMatch(/<h2[^>]*>\s*ค้นหาไม่สำเร็จ\s*<\/h2>/);
		expect(body).toContain('role="alert"');
		expect(body).toContain('border-amber-200');
	});

	it('becomes the page heading when asked', () => {
		const body = html(KioskNoticePanel, {
			props: { tone: 'success', icon: CircleAlert, title: 'ลงทะเบียนสำเร็จ', headingTag: 'h1' }
		});

		expect(body).toMatch(/<h1[^>]*>\s*ลงทะเบียนสำเร็จ\s*<\/h1>/);
		expect(body).toContain('border-emerald-200');
	});
});
