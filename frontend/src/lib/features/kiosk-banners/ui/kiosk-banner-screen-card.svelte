<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { KIOSK_SCREENS, type KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
	import { kioskBannerRemoteRepository } from '../data/kiosk-banner.remote';
	import type { ScreenSummary } from './kiosk-banner-order';

	/**
	 * One summary card per screen type: banner counts by state plus the first banners of the play
	 * order. The whole card links to that screen's manage page (`href`, already resolved by the
	 * caller).
	 */
	let { screen, summary, href }: { screen: KioskScreenType; summary: ScreenSummary; href: string } =
		$props();

	const STRIP_LIMIT = 6;

	const meta = $derived(KIOSK_SCREENS[screen]);
	const shown = $derived(summary.strip.slice(0, STRIP_LIMIT));
	const hidden = $derived(summary.strip.length - shown.length);
</script>

<a
	{href}
	class="flex min-h-11 w-full flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none sm:p-5"
	aria-label="จัดการแบนเนอร์{meta.label} {meta.size}"
>
	<span class="flex flex-col gap-1">
		<span class="text-lg font-bold text-slate-900">{meta.label} {meta.size}</span>
		<span class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700 tabular-nums">
			<span class="inline-flex items-center gap-1.5 font-semibold text-emerald-900">
				<span class="size-2 rounded-full bg-emerald-500" aria-hidden="true"></span>
				แสดงอยู่ {summary.active}
			</span>
			{#if summary.scheduled > 0}
				<span>รอแสดง {summary.scheduled}</span>
			{/if}
			{#if summary.inactive > 0}
				<span>ปิดอยู่ {summary.inactive}</span>
			{/if}
			{#if summary.expired > 0}
				<span class="text-slate-500">หมดอายุ {summary.expired}</span>
			{/if}
		</span>
	</span>

	<span class="flex min-h-16 flex-wrap items-center gap-2">
		{#if summary.strip.length === 0}
			<span class="text-sm text-slate-500">ยังไม่มีแบนเนอร์ที่ยังไม่หมดอายุ</span>
		{:else}
			{#each shown as banner, index (banner._id)}
				<span class="relative shrink-0">
					<img
						src={kioskBannerRemoteRepository.imageUrl(banner._id, banner._rev)}
						alt=""
						class={[
							'rounded-md border border-border bg-slate-100 object-contain',
							screen === 'portrait' ? 'h-14 w-8' : 'h-10 w-16'
						]}
						loading="lazy"
					/>
					<span
						data-testid="strip-order"
						class="absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white tabular-nums"
						>{index + 1}</span
					>
				</span>
			{/each}
			{#if hidden > 0}
				<span class="text-sm font-semibold text-slate-600 tabular-nums">+{hidden}</span>
			{/if}
		{/if}
	</span>

	<span class="inline-flex items-center justify-end gap-1 text-sm font-semibold text-primary">
		จัดการ
		<ChevronRight class="size-4" aria-hidden="true" />
	</span>
</a>
