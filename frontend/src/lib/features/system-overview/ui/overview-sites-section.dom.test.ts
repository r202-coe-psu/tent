// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import Section from './overview-sites-section.svelte';

vi.mock('$lib/features/master-data', () => ({
	useMasterData: () => ({ data: undefined }),
	formatMasterLabelByCode: (code: string) => code
}));
vi.mock('$lib/states/i18n.svelte', () => ({ langState: { current: 'th' } }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

const site = (code: string) => ({
	shelter_code: code,
	name: `Shelter ${code}`,
	site_kind: 'evacuation_center',
	operation_status: 'active',
	present: 1,
	forecast: 1,
	present_pct: 10,
	forecast_pct: 10,
	checkin: 0,
	checkout: 0,
	has_coords: false,
	dashboard_href: '/back-office/evacuee-management'
});

let instance: ReturnType<typeof mount> | null = null;

async function render(props: { total: number; limit: number; offset: number }) {
	const onOffsetChange = vi.fn();
	instance = mount(Section, {
		target: document.body,
		props: {
			sites: [site('A')] as never,
			movementFrom: '2026-01-01',
			movementTo: '2026-01-02',
			onMovementRangeChange: vi.fn(),
			onOffsetChange,
			...props
		}
	});
	await tick();
	flushSync();
	return onOffsetChange;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('overview-sites-section paging', () => {
	it('shows the range, marks the current page and disables Previous on page 1', async () => {
		const onChange = await render({ total: 9, limit: 4, offset: 0 });
		expect(document.body.textContent).toContain('แสดง 1 - 4 จาก 9 แห่ง');
		expect(document.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('1');
		expect(
			document.querySelector('[aria-label="Go to previous page"]')?.hasAttribute('disabled')
		).toBe(true);
		(document.querySelector('[aria-label="Go to next page"]') as HTMLElement).click();
		await tick();
		expect(onChange).toHaveBeenCalledWith(4);
	});

	it('clamps the range end and disables Next on the last page', async () => {
		const onChange = await render({ total: 9, limit: 4, offset: 8 });
		expect(document.body.textContent).toContain('แสดง 9 - 9 จาก 9 แห่ง');
		expect(document.querySelector('[aria-label="Go to next page"]')?.hasAttribute('disabled')).toBe(
			true
		);
		(document.querySelector('[aria-label="Go to previous page"]') as HTMLElement).click();
		await tick();
		expect(onChange).toHaveBeenCalledWith(4);
	});

	it('hides the pager when everything fits on one page', async () => {
		await render({ total: 3, limit: 4, offset: 0 });
		expect(document.querySelector('[aria-label="Go to next page"]')).toBeNull();
	});
});
