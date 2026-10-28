// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PoolTimelineEvent } from '../../domain/food-supplies';
import {
	poolTimelineSkippedBadge,
	poolTimelineSkippedNotice
} from '../model/bulk-return-timeline-copy';
import BulkReturnPoolTimeline from './BulkReturnPoolTimeline.svelte';

let instance: ReturnType<typeof mount> | null = null;

function render(props: {
	skipped?: { _id: string }[];
	isLoading?: boolean;
	isError?: boolean;
	expanded?: boolean;
	events?: PoolTimelineEvent[];
}) {
	const { expanded = false, ...rest } = props;
	instance = mount(BulkReturnPoolTimeline, {
		target: document.body,
		props: { events: [], catalog: [], poolNameById: new Map(), ...rest }
	});
	flushSync();
	if (expanded) {
		document.body.querySelector('button')?.click();
		flushSync();
	}
}

const byId = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('pool timeline skipped docs', () => {
	it('shows a badge in the collapsed header but not the banner', () => {
		render({ skipped: [{ _id: 'x' }] });

		expect(byId('bulk-return-timeline-skipped-badge')).not.toBeNull();
		expect(byId('bulk-return-timeline-skipped-docs')).toBeNull();
	});

	it('shows no badge when nothing was skipped', () => {
		render({});

		expect(byId('bulk-return-timeline-skipped-badge')).toBeNull();
	});

	it('shows the banner with the id and a non-contradictory empty label when expanded', () => {
		render({ skipped: [{ _id: 'bulk_return_entry:bad-1' }], expanded: true });

		const banner = byId('bulk-return-timeline-skipped-docs');
		expect(banner?.textContent).toContain('(bulk_return_entry:bad-1)');
		expect(text()).toContain('ไม่มีประวัติที่แสดงได้');
		expect(text()).not.toContain('ยังไม่มีประวัติ');
	});

	it('shows the banner together with the opened event (real production shape)', () => {
		const opened: PoolTimelineEvent = {
			id: 'pool-1',
			kind: 'opened',
			at: '2026-01-01T00:00:00.000Z',
			by: 'staff'
		};
		render({ events: [opened], skipped: [{ _id: 'bulk_return_entry:bad-1' }], expanded: true });

		expect(byId('bulk-return-timeline-skipped-docs')?.textContent).toContain(
			'(bulk_return_entry:bad-1)'
		);
		expect(text()).toContain('เปิดกอง');
	});

	it('renders the skipped count and ids via the canonical copy helpers', () => {
		const opened: PoolTimelineEvent = {
			id: 'pool-1',
			kind: 'opened',
			at: '2026-01-01T00:00:00.000Z',
			by: 'staff'
		};
		render({ events: [opened], skipped: [{ _id: 'a' }, { _id: 'b' }] });

		expect(byId('bulk-return-timeline-skipped-badge')?.textContent).toContain(
			poolTimelineSkippedBadge(2)
		);

		document.body.querySelector('button')?.click();
		flushSync();

		const banner = byId('bulk-return-timeline-skipped-docs');
		expect(banner?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			`${poolTimelineSkippedNotice(2)} (a, b)`
		);
	});

	it('shows no header badge on error', () => {
		render({ skipped: [{ _id: 'x' }], isError: true });

		expect(byId('bulk-return-timeline-skipped-badge')).toBeNull();
	});

	it('shows no header badge while loading', () => {
		render({ skipped: [{ _id: 'x' }], isLoading: true });

		expect(byId('bulk-return-timeline-skipped-badge')).toBeNull();
	});

	it('hides the banner while loading', () => {
		render({ skipped: [{ _id: 'x' }], isLoading: true, expanded: true });

		expect(byId('bulk-return-timeline-skipped-docs')).toBeNull();
	});

	it('hides the banner on error', () => {
		render({ skipped: [{ _id: 'x' }], isError: true, expanded: true });

		expect(byId('bulk-return-timeline-skipped-docs')).toBeNull();
	});
});
