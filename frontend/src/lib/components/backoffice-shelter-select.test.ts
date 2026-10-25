import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import BackofficeShelterSelect from './backoffice-shelter-select.svelte';

const shelters = [
	{ code: 'SH001', name: 'ศูนย์พักพิงหาดใหญ่' },
	{ code: 'SH002', name: 'ศูนย์พักพิงสงขลา' }
];

const shelterState = vi.hoisted(() => ({ selectedShelterCode: 'SH002' as string | undefined }));

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/back-office/dashboard') }
}));

vi.mock('$lib/features/shelters', () => ({
	useShelters: () => ({ data: shelters, isLoading: false })
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { user: { roles: ['system_admin'] } }
}));

vi.mock('$lib/stores/shelter.svelte', () => ({
	shelterStore: shelterState,
	persistSelectedShelter: vi.fn()
}));

// Same boundary stub as shelter-scope-select.test.ts: the closed popover never renders under SSR,
// so keep the trigger's children and expose only what the assertions read.
vi.mock('$lib/components/ui/select', () => {
	type Renderer = { push: (html: string) => void };
	type Snippet = (renderer: Renderer) => void;
	type StubProps = { children?: Snippet; value?: string; label?: string };
	return {
		Select: (r: Renderer, p: StubProps) => p.children?.(r),
		SelectTrigger: (r: Renderer, p: StubProps) => {
			r.push('<button data-slot="select-trigger">');
			p.children?.(r);
			r.push('</button>');
		},
		SelectContent: (r: Renderer, p: StubProps) => p.children?.(r),
		SelectItem: (r: Renderer, p: StubProps) => r.push(`<li data-value="${p.value}">${p.label}</li>`)
	};
});

const renderSelect = (props: { compact?: boolean } = {}) =>
	render(BackofficeShelterSelect, { props }).body;

const triggerHtml = (html: string) =>
	html.match(/<button data-slot="select-trigger">([\s\S]*?)<\/button>/)?.[1] ?? '';

describe('BackofficeShelterSelect', () => {
	beforeEach(() => {
		shelterState.selectedShelterCode = 'SH002';
	});

	it('names the selected shelter inside the compact trigger for screen readers', () => {
		const trigger = triggerHtml(renderSelect({ compact: true }));

		expect(trigger).toContain('<span class="sr-only">SH002 — ศูนย์พักพิงสงขลา</span>');
	});

	it('falls back to the placeholder name in the compact trigger when nothing is selected', () => {
		shelterState.selectedShelterCode = undefined;
		const trigger = triggerHtml(renderSelect({ compact: true }));

		expect(trigger).toContain('<span class="sr-only">เลือกศูนย์อพยพ</span>');
	});

	it('shows the selected shelter as visible text in the expanded trigger without a duplicate', () => {
		const html = renderSelect();

		expect(html).toContain('<span class="truncate">SH002 — ศูนย์พักพิงสงขลา</span>');
		expect(html).not.toContain('sr-only');
	});
});
