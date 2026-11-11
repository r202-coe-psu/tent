// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ConsulateExportDialog from './consulate-export-dialog.svelte';

let instance: ReturnType<typeof mount> | null = null;

async function render(props: {
	countries: { country: string; count: number }[];
	onConfirm?: (c: string) => void;
	isExporting?: boolean;
	lookupsReady?: boolean;
	lookupsError?: boolean;
	onRetryLookups?: () => void;
}) {
	instance = mount(ConsulateExportDialog, {
		target: document.body,
		props: { open: true, onConfirm: () => {}, ...props }
	});
	await tick();
	await new Promise((r) => setTimeout(r, 20));
	flushSync();
}

const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const exportBtn = () =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === 'Export'
	)!;

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	// bits-ui restores the body style 24ms after the dialog's scroll lock goes; let that timer run
	// here, or it fires after the file's DOM is torn down ("document is not defined").
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('ConsulateExportDialog (S6, FR-11/12)', () => {
	const countries = [
		{ country: 'MYANMAR', count: 4 },
		{ country: 'LAOS', count: 1 }
	];

	it('lists each country with its head count and has no "all countries" option', async () => {
		await render({ countries });
		expect(radios().map((r) => r.value)).toEqual(['MYANMAR', 'LAOS']);
		const text = document.body.textContent ?? '';
		expect(text).toContain('4 คน');
		expect(text).toContain('1 คน');
		expect(text).not.toMatch(/ทุกประเทศ|ทั้งหมด|all/i);
		expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
	});

	it('keeps Export disabled until one country is picked, then exports exactly that one', async () => {
		const onConfirm = vi.fn();
		await render({ countries, onConfirm });
		expect(exportBtn().disabled).toBe(true);

		radios()[1].click();
		await tick();
		flushSync();
		expect(exportBtn().disabled).toBe(false);

		// picking another replaces the first — single selection only
		radios()[0].click();
		await tick();
		flushSync();
		expect(radios().filter((r) => r.checked)).toHaveLength(1);

		exportBtn().click();
		expect(onConfirm).toHaveBeenCalledExactlyOnceWith('MYANMAR');
	});

	it('shows an empty state with no choices and a disabled Export when there are no foreigners', async () => {
		await render({ countries: [] });
		expect(radios()).toHaveLength(0);
		expect(document.body.textContent).toContain('ไม่มีผู้ประสบภัยชาวต่างชาติ');
		expect(exportBtn().disabled).toBe(true);
	});

	it('disables Export while an export is running', async () => {
		await render({ countries, isExporting: true });
		radios()[0].click();
		await tick();
		flushSync();
		const busy = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('กำลังสร้างไฟล์')
		) as HTMLButtonElement;
		expect(busy.disabled).toBe(true);
	});

	it('keeps Export disabled while zone / vulnerable-group labels are still loading', async () => {
		await render({ countries, lookupsReady: false });
		radios()[0].click();
		await tick();
		flushSync();
		expect(exportBtn().disabled).toBe(true);
		expect(document.body.textContent).toContain('กำลังโหลดชื่อโซนและกลุ่มเปราะบาง');
	});

	it('forgets the picked country after the dialog is closed and reopened', async () => {
		await render({ countries });
		radios()[0].click();
		await tick();
		flushSync();
		expect(exportBtn().disabled).toBe(false);
		[...document.querySelectorAll<HTMLButtonElement>('button')]
			.find((b) => b.textContent?.trim() === 'ยกเลิก')!
			.click();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
		unmount(instance!);
		document.body.innerHTML = '';
		await render({ countries });
		expect(radios().every((r) => !r.checked)).toBe(true);
	});

	it('shows an error with a retry (not an endless spinner) when the labels fail to load', async () => {
		const onRetryLookups = vi.fn();
		await render({ countries, lookupsReady: false, lookupsError: true, onRetryLookups });
		const text = document.body.textContent ?? '';
		expect(text).toContain('โหลดชื่อโซนและกลุ่มเปราะบางไม่สำเร็จ');
		expect(text).not.toContain('กำลังโหลดชื่อโซนและกลุ่มเปราะบาง...');
		expect(exportBtn().disabled).toBe(true);
		[...document.querySelectorAll<HTMLButtonElement>('button')]
			.find((b) => b.textContent?.trim() === 'ลองใหม่')!
			.click();
		expect(onRetryLookups).toHaveBeenCalledTimes(1);
	});
});
