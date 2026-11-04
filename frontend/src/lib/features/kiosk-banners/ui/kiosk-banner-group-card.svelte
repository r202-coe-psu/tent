<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Cpu from '@lucide/svelte/icons/cpu';
	import {
		KIOSK_SCREENS,
		KIOSK_SCREEN_TYPES,
		type KioskScreenType
	} from '$lib/features/shared/domain/kiosk-screen';
	import type { ScreenSummary } from './kiosk-banner-order';

	/**
	 * One card per banner group: name, how many kiosks are in it and, per screen size, how many of
	 * its banners are live or waiting. The whole card links to the group page.
	 */
	let {
		group,
		deviceCount,
		summaries
	}: {
		group: { _id: string; name: string; description?: string | null };
		deviceCount: number;
		summaries: Record<KioskScreenType, ScreenSummary>;
	} = $props();
</script>

<a
	href={resolve(`/back-office/kiosks/banners/groups/${encodeURIComponent(group._id)}`)}
	class="flex min-h-11 w-full flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none sm:p-5"
	aria-label="จัดการกลุ่มแบนเนอร์ {group.name}"
>
	<span class="flex flex-col gap-1">
		<span class="text-lg font-bold break-words text-slate-900">{group.name}</span>
		{#if group.description}
			<span class="text-sm break-words text-slate-600">{group.description}</span>
		{/if}
		<span class="inline-flex items-center gap-1.5 text-sm text-slate-700 tabular-nums">
			<Cpu class="size-4" aria-hidden="true" />
			{deviceCount} เครื่อง
		</span>
	</span>

	<span class="flex flex-col gap-1.5">
		{#each KIOSK_SCREEN_TYPES as type (type)}
			{@const meta = KIOSK_SCREENS[type]}
			{@const summary = summaries[type]}
			<span
				data-testid="screen-summary"
				class="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-slate-700 tabular-nums"
			>
				<span class="font-semibold text-slate-900">{meta.label} {meta.size}</span>
				<span class="inline-flex items-center gap-1.5 font-semibold text-emerald-900">
					<span class="size-2 rounded-full bg-emerald-500" aria-hidden="true"></span>
					แสดงอยู่ {summary.active}
				</span>
				{#if summary.scheduled > 0}
					<span>รอแสดง {summary.scheduled}</span>
				{/if}
			</span>
		{/each}
	</span>

	<span class="inline-flex items-center justify-end gap-1 text-sm font-semibold text-primary">
		จัดการ
		<ChevronRight class="size-4" aria-hidden="true" />
	</span>
</a>
