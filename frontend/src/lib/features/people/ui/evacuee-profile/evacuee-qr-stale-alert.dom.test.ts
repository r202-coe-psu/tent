// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { EvacueeQrPrintRef } from '$lib/utils/evacuee-qr';
import type { VulnerabilityMarker } from '$lib/utils/vulnerability-marker';

import EvacueeQrStaleAlert from './evacuee-qr-stale-alert.svelte';

const MESSAGE = 'บัตรล้าสมัย — ระดับความเปราะบางเปลี่ยน';
const printed = (marker?: VulnerabilityMarker | null): EvacueeQrPrintRef => ({
	printed_at: '2026-11-10T03:00:00.000Z',
	hash: 'aaaaaa',
	...(marker === undefined ? {} : { marker })
});

let instance: ReturnType<typeof mount> | null = null;

function render(props: {
	current: VulnerabilityMarker | null;
	prints: readonly EvacueeQrPrintRef[];
	onReprint?: () => void;
}) {
	const onReprint = props.onReprint ?? vi.fn();
	instance = mount(EvacueeQrStaleAlert, { target: document.body, props: { ...props, onReprint } });
	flushSync();
	return onReprint;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('EvacueeQrStaleAlert', () => {
	it('warns that the card is outdated when the level changed since the last print, and offers a reprint', () => {
		const onReprint = render({ current: 'red', prints: [printed('yellow')] });

		expect(document.body.textContent).toContain(MESSAGE);
		const button = [...document.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'พิมพ์บัตรใหม่'
		);
		button!.click();
		expect(onReprint).toHaveBeenCalledTimes(1);
	});

	it('renders nothing while the level still matches the last printed card', () => {
		render({ current: 'red', prints: [printed('yellow'), printed('red')] });
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('renders nothing when the card was never printed', () => {
		render({ current: 'red', prints: [] });
		expect(document.body.textContent?.trim()).toBe('');
	});
});
