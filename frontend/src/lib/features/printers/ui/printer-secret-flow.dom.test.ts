// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import Harness from './__fixtures__/printer-secret-flow-harness.svelte';

const mutateAsync = vi.fn();
vi.mock('../application/queries', () => ({
	useCreatePrinterDevice: () => ({ mutateAsync, isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SECRET = 'sk_print_0123456789abcdef0123456789abcdef';
const created = {
	device: {
		id: 'print_device:printer-sh001-reg1',
		device_id: 'printer-sh001-reg1',
		name: 'โต๊ะลงทะเบียน 1',
		shelter_code: 'SH001',
		station: 'ลงทะเบียน',
		host_kind: 'standalone',
		status: 'active',
		secret_prefix: 'sk_print_0123',
		last_seen_at: null,
		queue_state: 'unknown',
		agent_version: null,
		online: false
	},
	secret: SECRET
};

let instance: ReturnType<typeof mount> | null = null;

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
function type(id: string, value: string) {
	const input = field(id);
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}
const buttonByText = (text: string) =>
	[...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.replace(/\s+/g, ' ').trim() === text
	) as HTMLButtonElement | undefined;
async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}
const pageText = () => document.body.textContent ?? '';
const pageValues = () => [...document.body.querySelectorAll('input')].map((i) => i.value).join('|');

beforeEach(async () => {
	vi.clearAllMocks();
	mutateAsync.mockResolvedValue(created);
	instance = mount(Harness, { target: document.body });
	await settle();
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('create printer → reveal secret', () => {
	async function createPrinter() {
		type('printer-device-id', 'printer-sh001-reg1');
		type('printer-name', 'โต๊ะลงทะเบียน 1');
		type('printer-station', 'ลงทะเบียน');
		flushSync();
		buttonByText('สร้างและรับ Secret')?.click();
		await settle();
	}

	it('sends the new printer to the server for the active shelter', async () => {
		await createPrinter();

		expect(mutateAsync).toHaveBeenCalledWith({
			device_id: 'printer-sh001-reg1',
			name: 'โต๊ะลงทะเบียน 1',
			shelter_code: 'SH001',
			station: 'ลงทะเบียน',
			host_kind: 'standalone'
		});
	});

	it('shows the secret once with a ready-to-paste .env snippet', async () => {
		await createPrinter();

		expect(pageValues()).toContain(SECRET);
		const snippet = pageText();
		expect(snippet).toContain('TENT_BASE_URL=');
		expect(snippet).toContain('DEVICE_ID=printer-sh001-reg1');
		expect(snippet).toContain(`DEVICE_SECRET=${SECRET}`);
		expect(snippet).toContain('PRINTER_NAME=tent_xprinter');
	});

	it('drops the secret from the page once the reveal dialog is closed', async () => {
		await createPrinter();
		buttonByText('ปิดหน้าต่าง')?.click();
		await settle();

		expect(pageText()).not.toContain(SECRET);
		expect(pageValues()).not.toContain(SECRET);
	});

	it('does not call the server when the Device ID is invalid', async () => {
		type('printer-device-id', 'X');
		type('printer-name', 'โต๊ะ');
		flushSync();
		buttonByText('สร้างและรับ Secret')?.click();
		await settle();

		expect(mutateAsync).not.toHaveBeenCalled();
	});
});
