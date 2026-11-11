// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const save = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/features/catalog', () => ({
	useItemMasters: () => ({ data: [] }),
	useUnitsOfMeasure: () => ({ data: [] }),
	formatUnit: (v: string) => v
}));
vi.mock('$lib/states/i18n.svelte', () => ({ langState: { current: 'th' } }));
vi.mock('../application/requirement-group-queries', () => ({
	useSaveRequirementGroup: () => ({ mutateAsync: save, isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import RequirementGroupForm from './requirement-group-form.svelte';

let instance: ReturnType<typeof mount> | undefined;
afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	save.mockClear();
});

async function render() {
	instance = mount(RequirementGroupForm, {
		target: document.body,
		props: {
			isEdit: true,
			group: {
				_id: 'requirement_group:X',
				type: 'requirement_group',
				schema_v: 2,
				name: 'X',
				standard_uom: 'kg',
				source: 'SPHERE_BASELINE',
				created_at: '2026-01-01T00:00:00.000Z',
				updated_at: '2026-01-01T00:00:00.000Z',
				created_by: 'user:test',
				item_maps: [
					{ item_id: 'item:x', base_uom: 'kg', conversion_factor: '1', share_percent: '40' }
				]
			}
		}
	});
	flushSync();
	await tick();
}
async function setShare(value: string) {
	const input = document.querySelector<HTMLInputElement>('#item-map-share-0')!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	await tick();
}
async function submit() {
	document
		.querySelector('form')!
		.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
	await tick();
}

describe('requirement group share form', () => {
	it('clears a previously saved share without emitting zero', async () => {
		await render();
		await setShare('');
		await submit();
		expect(save).toHaveBeenCalledOnce();
		expect(save.mock.calls[0][0].input.item_maps[0]).not.toHaveProperty('share_percent');
	});
	it('preserves an explicit zero', async () => {
		await render();
		await setShare('0');
		await submit();
		expect(save.mock.calls[0][0].input.item_maps[0].share_percent).toBe('0');
	});
	it.each(['-1', '100.0001'])('rejects out-of-range share %s', async (value) => {
		await render();
		await setShare(value);
		await submit();
		expect(save).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('สัดส่วนต้องอยู่ระหว่าง 0-100%');
	});
	it('accepts a value that rounds to 100', async () => {
		await render();
		await setShare('100.00004');
		await submit();
		expect(save.mock.calls[0][0].input.item_maps[0].share_percent).toBe('100');
	});
});
