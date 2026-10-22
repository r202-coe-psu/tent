// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import Harness from './__fixtures__/master-tag-input-harness.svelte';

const items = [
	{
		code: 'diabetes',
		label_th: 'เบาหวาน',
		label_en: 'Diabetes',
		is_default: false,
		status: 'active' as const
	},
	{
		code: 'asthma',
		label_th: 'หอบหืด',
		label_en: 'Asthma',
		is_default: false,
		status: 'active' as const
	},
	{
		code: 'gout',
		label_th: 'เกาต์',
		label_en: 'Gout',
		is_default: false,
		status: 'inactive' as const
	}
];

let instance: ReturnType<typeof mount> | null = null;

/** The bound `value` as the parent sees it (what the form would store). */
const bound = (): string[] =>
	JSON.parse(document.querySelector('[data-testid="value"]')?.textContent ?? '[]');

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

async function render(initial: string[]) {
	instance = mount(Harness, { target: document.body, props: { initial, items } });
	await settle();
}

const tags = () =>
	[...document.body.querySelectorAll('ul[aria-label="โรคประจำตัวที่เลือก"] li')].map((li) =>
		li.querySelector('span')?.textContent?.trim()
	);

const buttonByText = (text: string) =>
	[
		...document.body.querySelectorAll<HTMLElement>('button, [role="option"], [data-command-item]')
	].find((el) => el.textContent?.includes(text));

async function openPicker() {
	(document.getElementById('tags') as HTMLButtonElement).click();
	await settle();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('MasterTagInput (CR-186)', () => {
	it('shows codes by label and free text as typed', async () => {
		await render(['asthma', 'โรคเกาต์']);

		expect(tags()).toEqual(['หอบหืด', 'โรคเกาต์']);
	});

	it('removes a tag with its remove button', async () => {
		await render(['asthma', 'โรคเกาต์']);

		buttonByText('ลบ หอบหืด')?.click();
		await settle();

		expect(tags()).toEqual(['โรคเกาต์']);
	});

	it('adds an active master item picked from the list', async () => {
		await render([]);
		await openPicker();

		buttonByText('เบาหวาน')?.click();
		await settle();

		expect(tags()).toEqual(['เบาหวาน']);
		expect(bound()).toEqual(['diabetes']);
	});

	it('offers only active items in the list', async () => {
		await render([]);
		await openPicker();

		expect(buttonByText('หอบหืด')).toBeDefined();
		expect(buttonByText('เกาต์')).toBeUndefined();
	});

	it('adds typed free text and clears the search', async () => {
		await render([]);
		await openPicker();

		const input = document.body.querySelector('input') as HTMLInputElement;
		input.value = 'ไมเกรน, เรื้อรัง';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		buttonByText('เพิ่ม “ไมเกรน  เรื้อรัง”')?.click();
		await settle();

		expect(tags()).toEqual(['ไมเกรน  เรื้อรัง']);
		expect(bound()).toEqual(['ไมเกรน  เรื้อรัง']);
		expect(input.value).toBe('');
	});

	it('keeps the label of an inactive item as text, not its code (FR-6)', async () => {
		await render([]);
		await openPicker();

		const input = document.body.querySelector('input') as HTMLInputElement;
		input.value = 'เกาต์';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		buttonByText('เพิ่ม “เกาต์”')?.click();
		await settle();

		expect(bound()).toEqual(['เกาต์']);
	});
});
