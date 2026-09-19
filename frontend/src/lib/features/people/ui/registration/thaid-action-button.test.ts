import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import ThaidActionButton from './thaid-action-button.svelte';

describe('ThaidActionButton', () => {
	it('renders ThaiD connect button and information', () => {
		const result = render(ThaidActionButton, {
			props: {}
		});
		expect(result.body).toContain('ดึงข้อมูลด้วย ThaiD');
		expect(result.body).toContain('เชื่อมต่อ ThaiD');
		expect(result.body).not.toContain('จำลอง / Mock');
		expect(result.body).not.toContain('เลือกข้อมูลจำลอง (Mock)');
	});

	it('renders in disabled state when disabled prop is true', () => {
		const result = render(ThaidActionButton, {
			props: {
				disabled: true
			}
		});
		expect(result.body).toContain('disabled');
		expect(result.body).toContain('เชื่อมต่อ ThaiD');
	});
});
