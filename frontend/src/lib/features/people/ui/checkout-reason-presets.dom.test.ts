// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import CheckoutReasonPresets from './checkout-reason-presets.svelte';

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

function render(props: { error?: string | null } = {}) {
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(CheckoutReasonPresets, { target, props: { idPrefix: 'co', ...props } });
	flushSync();
	const radio = (id: string) => target.querySelector<HTMLButtonElement>(`#co-${id}`)!;
	const detailLabel = () => target.querySelector('label[for="co-detail"]')!.textContent ?? '';
	return { target, radio, detailLabel };
}

describe('CheckoutReasonPresets (#1493)', () => {
	it('offers the five presets plus อื่นๆ as one radio group', () => {
		const { target } = render();
		const labels = [...target.querySelectorAll('[role="radio"]')].map((r) => r.id);
		expect(labels).toEqual([
			'co-กลับที่พักอาศัยเดิม',
			'co-พักอาศัยกับญาติ',
			'co-ย้ายไปศูนย์พักพิงแห่งอื่น',
			'co-ส่งต่อสถานพยาบาล',
			'co-ย้ายไปพักอาศัยที่อื่น',
			'co-other'
		]);
	});

	it('marks the detail optional for a preset and required for อื่นๆ', () => {
		const { radio, detailLabel } = render();
		radio('ส่งต่อสถานพยาบาล').click();
		flushSync();
		expect(radio('ส่งต่อสถานพยาบาล').getAttribute('aria-checked')).toBe('true');
		expect(detailLabel()).toContain('ไม่บังคับ');
		radio('other').click();
		flushSync();
		expect(detailLabel()).toContain('*');
		expect(detailLabel()).not.toContain('ไม่บังคับ');
	});

	it('shows the error inline as an alert', () => {
		const { target } = render({ error: 'กรุณาเลือกเหตุผล 1 ข้อ' });
		const alert = target.querySelector('[role="alert"]')!;
		expect(alert.textContent).toBe('กรุณาเลือกเหตุผล 1 ข้อ');
		expect(alert.id).toBe('co-error');
	});
});
