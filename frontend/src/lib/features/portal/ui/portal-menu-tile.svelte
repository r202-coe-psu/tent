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
	}

	let { item, state, selectedShelterCode }: Props = $props();

	const Icon = $derived(PORTAL_ICONS[item.icon]);
	const href = $derived(resolvePortalHref(item, selectedShelterCode));

	const focusRing =
		'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none';
	// Tiles sit inside a department card, so they stay flat (no shadow) until hovered.
	const tileBase = 'flex min-h-11 items-center gap-4 rounded-xl border p-4';
</script>

{#snippet title()}
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<span class="text-base font-semibold text-slate-900">{item.label}</span>
		{#if item.station}
			<span
				class="inline-flex items-center rounded-full border border-(color:--c-border) bg-(--c-subtle) px-2 py-0.5 text-xs font-semibold text-(color:--c-text) tabular-nums"
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
		class="{tileBase} border-(color:--c-border) bg-white transition-shadow hover:shadow-xs {focusRing}"
	>
		<span
			class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-(--c-subtle) text-(color:--c)"
			aria-hidden="true"
		>
			<Icon class="size-6" />
		</span>
		<div class="min-w-0 flex-1">
			{@render title()}
			<p class="mt-0.5 text-sm text-slate-600">{item.desc}</p>
		</div>
		<ChevronRight class="size-5 shrink-0 text-slate-400" aria-hidden="true" />
	</a>
{:else if state === 'checking'}
	<div aria-busy="true" class="{tileBase} border-slate-200/80 bg-white">
		<Skeleton class="size-12 shrink-0 rounded-xl" />
		<div class="min-w-0 flex-1 space-y-2">
			<Skeleton class="h-4 w-2/3" />
			<Skeleton class="h-3.5 w-full" />
		</div>
		<span class="sr-only">กำลังตรวจสอบการเปิดใช้งาน {item.label}</span>
	</div>
{:else}
	<div aria-disabled="true" class="{tileBase} border-dashed border-slate-300 bg-slate-50">
		<span
			class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
			aria-hidden="true"
		>
			<Icon class="size-6" />
		</span>
		<div class="min-w-0 flex-1">
			<span class="block text-base font-semibold text-slate-600">{item.label}</span>
			<p class="mt-0.5 text-sm text-slate-500">{item.desc}</p>
		</div>
		<span
			class="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600"
		>
			<Clock class="size-3.5" aria-hidden="true" />
			เร็วๆ นี้
		</span>
	</div>
{/if}
