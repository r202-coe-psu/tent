import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import IdentityMethodSelector from './identity-method-selector.svelte';

const PRINT_QR_HREF = 'href="/kiosk/print-qr';

describe('IdentityMethodSelector', () => {
	it('renders the main heading as ลงทะเบียน', () => {
		const result = render(IdentityMethodSelector, {
			props: { contextQuery: '', reprintEnabled: true, thaidCheckInEnabled: true }
		});

		expect(result.body).toMatch(/<h1[^>]*id="method-title"[^>]*>\s*ลงทะเบียน\s*<\/h1>/);
		expect(result.body).not.toMatch(/<h1[^>]*>\s*รายงานตัว\s*<\/h1>/);
	});

	it('renders QR, card and ThaiD in a three-column single row, with no phone card', () => {
		const result = render(IdentityMethodSelector, {
			props: { contextQuery: '', reprintEnabled: true, thaidCheckInEnabled: true }
		});

		expect(result.body).toContain('grid-cols-3');
		expect(result.body).toContain('kiosk-portrait:grid-cols-1');
		expect(result.body).toContain('--method-count: 3');
		expect(result.body).toContain('data-single-row=""');
		expect(result.body).not.toContain('เบอร์โทรศัพท์');
		expect(result.body).not.toContain('กรอกเบอร์ที่ใช้ลงทะเบียน');
		expect(result.body.match(/class="method-card/g)).toHaveLength(3);
	});

	it('hides the ThaiD card and renders two cards in two columns when ThaiD is off', () => {
		const result = render(IdentityMethodSelector, {
			props: { contextQuery: '', reprintEnabled: false, thaidCheckInEnabled: false }
		});

		expect(result.body).toContain('grid-cols-2');
		expect(result.body).not.toContain('grid-cols-3');
		expect(result.body).toContain('--method-count: 2');
		expect(result.body).not.toContain('ThaiD');
		expect(result.body.match(/class="method-card/g)).toHaveLength(2);
	});

	it('hides the QR card when this machine turns QR check-in off', () => {
		const result = render(IdentityMethodSelector, {
			props: {
				contextQuery: '',
				qrCheckInEnabled: false,
				reprintEnabled: true,
				thaidCheckInEnabled: true
			}
		});

		expect(result.body).toContain('grid-cols-2');
		expect(result.body).toContain('--method-count: 2');
		expect(result.body).not.toContain('QR ลงทะเบียน');
		expect(result.body).not.toContain('/kiosk/qr');
		expect(result.body.match(/class="method-card/g)).toHaveLength(2);
	});

	it('shows the «พิมพ์ QR» link to the chooser under the grid, keeping the display context, when enabled', () => {
		const result = render(IdentityMethodSelector, {
			props: {
				contextQuery: '?shelter_code=SH001',
				reprintEnabled: true,
				thaidCheckInEnabled: true
			}
		});

		expect(result.body).toContain(`${PRINT_QR_HREF}?shelter_code=SH001"`);
		expect(result.body).toContain('พิมพ์ QR');
		expect(result.body).toContain('กรอกเบอร์โทรที่ลงทะเบียนไว้ เพื่อพิมพ์ QR Code');
		expect(result.body.indexOf('พิมพ์ QR')).toBeGreaterThan(result.body.indexOf('ThaiD'));
		// The reprint entry is not one of the method cards.
		expect(result.body.match(/class="method-card/g)).toHaveLength(3);
	});

	it('omits the reprint link when the shelter flag is off', () => {
		const result = render(IdentityMethodSelector, {
			props: { contextQuery: '', reprintEnabled: false, thaidCheckInEnabled: true }
		});

		expect(result.body).not.toContain('/kiosk/print-qr');
		expect(result.body).not.toContain('พิมพ์ QR');
		expect(result.body.match(/class="method-card/g)).toHaveLength(3);
	});
});
