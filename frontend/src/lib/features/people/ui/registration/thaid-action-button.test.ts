import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import ThaidActionButton from './thaid-action-button.svelte';

describe('ThaidActionButton', () => {
	it('renders mock button and badge in dev or mock mode', () => {
		const result = render(ThaidActionButton, {
			props: {
				status: { enabled: true, isDev: true, mode: 'mock' }
			}
		});
		expect(result.body).toContain('ดึงข้อมูลด้วย ThaiD');
		expect(result.body).toContain('จำลอง / Mock');
		expect(result.body).toContain('เลือกข้อมูลจำลอง (Mock)');
	});

	it('renders real connect button in production/staging mode when enabled', () => {
		const result = render(ThaidActionButton, {
			props: {
				status: { enabled: true, isDev: false, mode: 'real' }
			}
		});
		expect(result.body).toContain('ดึงข้อมูลด้วย ThaiD');
		expect(result.body).not.toContain('จำลอง / Mock');
		expect(result.body).toContain('เชื่อมต่อ ThaiD');
	});

	it('renders nothing when disabled in production/staging', () => {
		const result = render(ThaidActionButton, {
			props: {
				status: { enabled: false, isDev: false, mode: 'real' }
			}
		});
		expect(result.body).not.toContain('ดึงข้อมูลด้วย ThaiD');
	});
});
