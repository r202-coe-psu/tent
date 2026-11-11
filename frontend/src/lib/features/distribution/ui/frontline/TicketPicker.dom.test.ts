// @vitest-environment happy-dom
// #1183: what the desk sees and does in the ticket picker — filter by typing, Enter picks the
// first match, and the search is cleared once the list closes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { RequisitionTicket } from '../../domain/food-supplies';
import TicketPicker from './TicketPicker.svelte';

const ticket = (n: number, meal: 'breakfast' | 'dinner', destination: string, item: string) =>
	({
		_id: `requisition_ticket:0${n}`,
		type: 'requisition_ticket',
		ticket_no: `TKT-FOOD-90000${n}`,
		requisition_type: 'food',
		meal,
		destination_location: destination,
		created_at: '2026-11-05T01:00:00.000Z',
		status: 'DISTRIBUTING',
		items: [{ item_id: `item:${n}`, item_name: item }]
	}) as unknown as RequisitionTicket;

const TICKETS = [
	ticket(1, 'breakfast', 'ยิม', 'ข้าวกล่อง'),
	ticket(2, 'dinner', 'ยิม', 'ข้าวผัด'),
	ticket(3, 'dinner', 'โรงอาหาร', 'ต้มจืด')
];

let instance: ReturnType<typeof mount> | null = null;
let onPick: ReturnType<typeof vi.fn<(ticketId: string) => void>>;

async function settle() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
		flushSync();
	}
	await tick();
}

async function openPicker() {
	instance = mount(TicketPicker, {
		target: document.body,
		props: { id: 'pick', label: 'ตั๋ว', tickets: TICKETS, selectedId: '', onPick }
	});
	flushSync();
	document.querySelector<HTMLButtonElement>('button#pick')!.click();
	await settle();
}

const search = () => document.querySelector<HTMLInputElement>('input[type="search"]');
const options = () => [...document.querySelectorAll<HTMLButtonElement>('ul[aria-label] button')];

async function type(value: string) {
	const input = search()!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

beforeEach(() => {
	onPick = vi.fn<(ticketId: string) => void>();
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await settle();
	document.body.innerHTML = '';
});

describe('TicketPicker', () => {
	it('lists every ticket, then narrows to those matching every typed word', async () => {
		await openPicker();
		expect(options()).toHaveLength(3);

		await type('เย็น ยิม');

		expect(options()).toHaveLength(1);
		expect(options()[0].textContent).toContain('TKT-FOOD-900002');
	});

	it('says so when nothing matches', async () => {
		await openPicker();
		await type('ไม่มีตั๋วนี้');

		expect(options()).toHaveLength(0);
		expect(document.body.textContent).toContain('ไม่พบตั๋วที่ตรงกับคำค้น');
	});

	it('picks the first match on Enter and closes the list', async () => {
		await openPicker();
		await type('เย็น');
		search()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();

		expect(onPick).toHaveBeenCalledExactlyOnceWith('requisition_ticket:02');
		expect(search()).toBeNull();
	});

	it('starts with an empty search when it is opened again', async () => {
		await openPicker();
		await type('เย็น');
		options()[0].click();
		await settle();
		expect(onPick).toHaveBeenCalledTimes(1);

		document.querySelector<HTMLButtonElement>('button#pick')!.click();
		await settle();

		expect(search()!.value).toBe('');
		expect(options()).toHaveLength(3);
	});
});
