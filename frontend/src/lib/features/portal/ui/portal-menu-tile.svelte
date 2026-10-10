<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Clock from '@lucide/svelte/icons/clock';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import {
		resolvePortalHref,
		type PortalItemState,
		type PortalMenuItem
	} from '../domain/portal-menu';
	import { PORTAL_ICONS } from './portal-icons';

	interface Props {
		item: PortalMenuItem;
		state: PortalItemState;
		selectedShelterCode: string | null | undefined;
		/** `tile` = large card with description (default); `compact` = one-line row, no description. */
		variant?: 'tile' | 'compact';
	}

	let { item, state, selectedShelterCode, variant = 'tile' }: Props = $props();

	const Icon = $derived(PORTAL_ICONS[item.icon]);
	const href = $derived(resolvePortalHref(item, selectedShelterCode));
	const compact = $derived(variant === 'compact');

	const focusRing =
		'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none';
	// Tiles sit inside a department card, so they stay flat (no shadow) until hovered.
	const rowBase = $derived(
		compact
			? 'flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2'
			: 'flex min-h-11 items-center gap-4 rounded-xl border p-4'
	);
	const iconBox = $derived(compact ? 'size-8 rounded-lg' : 'size-12 rounded-xl');
	const iconSize = $derived(compact ? 'size-4' : 'size-6');
	const labelSize = $derived(compact ? 'text-sm' : 'text-base');
</script>

{#snippet title()}
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<span class="min-w-0 {labelSize} font-semibold text-slate-900">{item.label}</span>
		{#if item.station}
			<span
				class="inline-flex shrink-0 items-center rounded-full border border-(color:--c-border) bg-(--c-subtle) px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-(color:--c-text) tabular-nums"
			>
				สถานี {item.station}
			</span>
		{/if}
	</div>
{/snippet}

{#if state === 'ready' && href}
	<!-- `href` is a union of static pathnames; `resolve` takes one literal route, hence the cast. -->
	<a
		href={resolve(href as '/')}
		class="{rowBase} border-(color:--c-border) bg-white transition-shadow hover:shadow-xs {focusRing}"
	>
		<span
			class="flex shrink-0 items-center justify-center bg-(--c-subtle) text-(color:--c) {iconBox}"
			aria-hidden="true"
		>
			<Icon class={iconSize} />
		</span>
		<div class="min-w-0 flex-1">
			{@render title()}
			{#if !compact}
				<p class="mt-0.5 text-sm text-slate-600">{item.desc}</p>
			{/if}
		</div>
		<ChevronRight class="size-5 shrink-0 text-slate-400" aria-hidden="true" />
	</a>
{:else if state === 'checking'}
	<div aria-busy="true" class="{rowBase} border-slate-200/80 bg-white">
		<Skeleton class="shrink-0 {iconBox}" />
		<div class="min-w-0 flex-1 space-y-2">
			<Skeleton class={compact ? 'h-4 w-full' : 'h-4 w-2/3'} />
			{#if !compact}
				<Skeleton class="h-3.5 w-full" />
			{/if}
		</div>
		<span class="sr-only">กำลังตรวจสอบการเปิดใช้งาน {item.label}</span>
	</div>
{:else}
	<div aria-disabled="true" class="{rowBase} border-dashed border-slate-300 bg-slate-50">
		<span
			class="flex shrink-0 items-center justify-center bg-slate-100 text-slate-500 {iconBox}"
			aria-hidden="true"
		>
			<Icon class={iconSize} />
		</span>
		<div class="min-w-0 flex-1">
			<span class="block {labelSize} font-semibold text-slate-600">{item.label}</span>
			{#if !compact}
				<p class="mt-0.5 text-sm text-slate-500">{item.desc}</p>
			{/if}
		</div>
		<span
			class="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-slate-600"
		>
			<Clock class="size-3.5" aria-hidden="true" />
			เร็วๆ นี้
		</span>
	</div>
{/if}
