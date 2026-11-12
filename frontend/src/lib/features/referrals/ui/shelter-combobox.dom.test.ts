// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ShelterCombobox from './shelter-combobox.svelte';

const { shelters } = vi.hoisted(() => ({
	shelters: [] as Array<Record<string, unknown>>
}));

vi.mock('$lib/features/shelters', () => ({
	useSearchShelters: () => ({
		data: shelters,
		isPending: false,
		isError: false,
		error: null,
		refetch: vi.fn()
	})
}));

const shelter = (code: string, name: string, extra: Record<string, unknown> = {}) => ({
	code,
	name,
	operation_status: 'active',
	capacity: 100,
	province: 'สงขลา',
	...extra
});

let instance: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	shelters.length = 0;
});

async function openPicker() {
	const input = document.body.querySelector<HTMLInputElement>('input[role="combobox"]')!;
	input.dispatchEvent(new FocusEvent('focus'));
	flushSync();
	await tick();
	flushSync();
	return [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].map((el) =>
		el.textContent?.trim()
	);
}

function mountPicker() {
	instance = mount(ShelterCombobox, { target: document.body, props: { value: '' } });
	flushSync();
}

describe('shelter-combobox — #1343 accepts_referrals filter (FR-16)', () => {
	it('omits shelters whose accepts_referrals is false and keeps the rest', async () => {
		shelters.push(
			shelter('SH001', 'ศูนย์เปิดรับ', { accepts_referrals: true }),
			shelter('SH002', 'ศูนย์ปิดรับ', { accepts_referrals: false }),
			shelter('SH003', 'ศูนย์ไม่ระบุ')
		);
		mountPicker();

		const options = await openPicker();

		expect(options.some((t) => t?.includes('ศูนย์ปิดรับ'))).toBe(false);
		expect(options.some((t) => t?.includes('ศูนย์เปิดรับ'))).toBe(true);
		expect(options.some((t) => t?.includes('ศูนย์ไม่ระบุ'))).toBe(true);
	});

	it('still drops closed and cancelled shelters alongside the new filter', async () => {
		shelters.push(
			shelter('SH010', 'ศูนย์ปิดแล้ว', { operation_status: 'closed' }),
			shelter('SH011', 'ศูนย์ยกเลิก', { operation_status: 'cancelled' }),
			shelter('SH012', 'ศูนย์ที่เปิดอยู่')
		);
		mountPicker();

		const options = await openPicker();

		expect(options).toHaveLength(1);
		expect(options[0]).toContain('ศูนย์ที่เปิดอยู่');
	});
});
