// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import SystemOverviewPage from './system-overview-page.svelte';

type Props = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
	summaryGetters: [] as (() => Record<string, unknown>)[],
	onFilters: undefined as ((next: Record<string, unknown>) => void) | undefined,
	filters: {} as Record<string, unknown>,
	kindStrip: undefined as Props | undefined,
	phaseStrip: undefined as Props | undefined
}));

const idleQuery = { data: undefined, isError: false, isPending: false, isPlaceholderData: false };

vi.mock('../application/queries', () => ({
	// Tag each result with the filters it was requested with, so the strips can be asserted on.
	useOverviewSummary: (get: () => Record<string, unknown>) => {
		mocks.summaryGetters.push(get);
		return {
			get data() {
				return { requested_with: get() };
			},
			isError: false,
			isPending: false
		};
	},
	useOverviewSites: () => idleQuery,
	useOverviewOrigin: () => idleQuery,
	useOverviewDemographics: () => idleQuery
}));
vi.mock('./overview-filter-bar.svelte', () => ({
	default: (_anchor: unknown, props: { filters: Record<string, unknown>; onChange: never }) => {
		mocks.onFilters = props.onChange;
		Object.defineProperty(mocks, 'filters', { get: () => props.filters, configurable: true });
	}
}));
vi.mock('./overview-site-kind-strip.svelte', () => ({
	default: (_anchor: unknown, props: Props) => {
		mocks.kindStrip = props;
	}
}));
vi.mock('./overview-phase-strip.svelte', () => ({
	default: (_anchor: unknown, props: Props) => {
		mocks.phaseStrip = props;
	}
}));
vi.mock('./overview-sites-section.svelte', () => ({ default: () => {} }));
vi.mock('./overview-origin-section.svelte', () => ({ default: () => {} }));
vi.mock('./overview-demographics-section.svelte', () => ({ default: () => {} }));

const requestedWith = (props: Props | undefined) =>
	(props?.summary as { requested_with: Record<string, unknown> }).requested_with;

let instance: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	mocks.summaryGetters.length = 0;
	mocks.kindStrip = undefined;
	mocks.phaseStrip = undefined;
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

async function render() {
	instance = mount(SystemOverviewPage, { target: document.body });
	await tick();
	flushSync();
}

describe('system-overview-page site-kind cards (CR-266 FR-14 / D-4)', () => {
	it('requests the summary twice: once filtered, once with no filters at all', async () => {
		await render();
		expect(mocks.summaryGetters).toHaveLength(2);
		const unfiltered = mocks.summaryGetters.filter((get) => Object.keys(get()).length === 0);
		expect(unfiltered).toHaveLength(1);
	});

	it('does not change the site-kind cards when a filter is applied', async () => {
		await render();
		expect(requestedWith(mocks.kindStrip)).toEqual({});

		mocks.onFilters?.({ ...mocks.filters, external: 'only', site_kind: undefined });
		await tick();
		flushSync();

		// Cards stay fleet-wide…
		expect(requestedWith(mocks.kindStrip)).toEqual({});
		// …while the phase strip follows the filter.
		expect(requestedWith(mocks.phaseStrip)).toMatchObject({ external: 'only' });
	});
});
