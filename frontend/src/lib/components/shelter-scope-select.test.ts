import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ShelterScopeSelect from './shelter-scope-select.svelte';

const shelters = [
	{ code: 'SH001', name: 'ศูนย์พักพิงหาดใหญ่' },
	{ code: 'SH002', name: 'ศูนย์พักพิงสงขลา' },
	{ code: 'SH003', name: 'ศูนย์พักพิงปัตตานี' }
];

vi.mock('$lib/features/shelters', () => ({
	useShelters: () => ({ data: shelters, isLoading: false })
}));

// The real Select keeps its options in a closed popover that SSR never renders, so swap the
// shadcn wrappers (a UI-library boundary) for plain markup that exposes what we hand them.
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

type Props = { allowedCodes: string[] | null; includeAll?: boolean; value?: string };

const body = (props: Props) => render(ShelterScopeSelect, { props }).body;
const optionValues = (html: string) =>
	[...html.matchAll(/<li data-value="([^"]*)"/g)].map((m) => m[1]);

describe('ShelterScopeSelect', () => {
	it('shows a single allowed shelter as read-only text with no select trigger', () => {
		const html = body({ allowedCodes: ['SH002'] });

		expect(html).toContain('ศูนย์พักพิงสงขลา');
		expect(html).not.toContain('ศูนย์พักพิงหาดใหญ่');
		expect(html).not.toContain('select-trigger');
	});

	it('offers every shelter when allowedCodes is null', () => {
		const html = body({ allowedCodes: null });

		expect(optionValues(html)).toEqual(['SH001', 'SH002', 'SH003']);
		expect(html).toContain('ศูนย์พักพิงปัตตานี');
	});

	it('adds「ทุกศูนย์」ahead of the shelters when includeAll is set', () => {
		const html = body({ allowedCodes: null, includeAll: true });

		expect(optionValues(html)).toEqual(['__all__', 'SH001', 'SH002', 'SH003']);
		expect(html).toContain('>ทุกศูนย์</li>');
	});

	it('does not offer「ทุกศูนย์」by default', () => {
		expect(body({ allowedCodes: null })).not.toContain('ทุกศูนย์');
	});

	it('offers exactly the allowed shelters when given two codes', () => {
		const html = body({ allowedCodes: ['SH003', 'SH001'] });

		expect(optionValues(html)).toEqual(['SH001', 'SH003']);
		expect(html).not.toContain('ศูนย์พักพิงสงขลา');
	});

	it('shows the chosen shelter on the trigger', () => {
		const html = body({ allowedCodes: null, value: 'SH002' });

		expect(html).toContain('SH002 — ศูนย์พักพิงสงขลา</span></button>');
	});

	it('shows「ทุกศูนย์」on the trigger when includeAll and nothing is chosen', () => {
		const html = body({ allowedCodes: null, includeAll: true });

		expect(html).toContain('<span class="truncate">ทุกศูนย์</span></button>');
	});
});
