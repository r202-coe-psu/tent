import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import KioskLookupErrorActions from './kiosk-lookup-error-actions.svelte';

const defaultProps = {
	isPhoneGate: true,
	isLookingUp: false,
	retryAfterSeconds: 0,
	homeUrl: '/kiosk?shelter_code=SH001',
	backUrl: '/kiosk/phone?shelter_code=SH001',
	onretry: vi.fn(),
	onreset: vi.fn()
};

describe('KioskLookupErrorActions', () => {
	it('does not offer retry and sends the back action home when the method is disabled', () => {
		const result = render(KioskLookupErrorActions, {
			props: { ...defaultProps, lookupErrorCode: 'KIOSK_METHOD_DISABLED' }
		});

		expect(result.body).not.toContain('ลองอีกครั้ง');
		expect(result.body).toContain('href="/kiosk?shelter_code=SH001"');
		expect(result.body).not.toContain('/kiosk/phone?shelter_code=SH001');
		expect(result.body).toContain('กลับ');
	});
});
