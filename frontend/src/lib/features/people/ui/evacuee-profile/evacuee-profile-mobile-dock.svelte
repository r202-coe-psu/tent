<script lang="ts">
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import { fly } from 'svelte/transition';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { EVACUEE_PROFILE_I18N } from '../_constants/evacuee-profile.i18n';

	let {
		visible,
		readonly,
		onOpenZoneModal,
		onOpenActions
	}: {
		visible: boolean;
		readonly: boolean;
		onOpenZoneModal: () => void;
		onOpenActions: () => void;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_PROFILE_I18N, langState.current).mobileDock);
</script>

{#if visible}
	<div
		class="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 px-3 pt-3 shadow-xs backdrop-blur-sm lg:hidden"
		style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))"
		role="toolbar"
		aria-label={t.ariaLabel}
		transition:fly={{ y: 64, duration: 200 }}
	>
		{#if !readonly}
			<div class="grid grid-cols-2 gap-2">
				<button
					type="button"
					onclick={onOpenZoneModal}
					class="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-amber-400 bg-transparent px-3 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					{t.changeZone}
				</button>
				<button
					type="button"
					onclick={onOpenActions}
					class="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#0A2647] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					{t.actions}
					<ChevronUp class="size-4" />
				</button>
			</div>
		{:else}
			<button
				type="button"
				onclick={onOpenActions}
				class="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#0A2647] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
			>
				{t.actions}
				<ChevronUp class="size-4" />
			</button>
		{/if}
	</div>
{/if}
