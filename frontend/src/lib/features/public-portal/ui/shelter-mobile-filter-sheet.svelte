<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Filter from '@lucide/svelte/icons/filter';
	import X from '@lucide/svelte/icons/x';

	import ShelterFilterPanel from './shelter-filter-panel.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	/** Mobile (< lg) bottom sheet holding the `/shelters` search and filter form. */
	let {
		open = $bindable(false),
		filters,
		availableTypes,
		userLat = $bindable(''),
		userLng = $bindable('')
	}: {
		open?: boolean;
		filters: ComponentProps<typeof ShelterFilterPanel>['filters'];
		availableTypes: ComponentProps<typeof ShelterFilterPanel>['availableTypes'];
		userLat?: string;
		userLng?: string;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs lg:hidden">
		<!-- Backdrop tap to close -->
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			onclick={() => (open = false)}
			aria-label="Close filter drawer"
		></button>

		<!-- Sheet Modal Content -->
		<div
			class="relative z-10 flex max-h-[85vh] w-full animate-in flex-col rounded-t-3xl border-t border-border bg-card shadow-2xl duration-300 slide-in-from-bottom"
		>
			<div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
				<div class="flex items-center gap-2">
					<Filter class="h-4 w-4 text-primary" />
					<h3 class="text-sm font-bold text-foreground">{t.searchAndFilter}</h3>
				</div>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
					onclick={() => (open = false)}
					aria-label="Close filter drawer"
				>
					<X class="h-4 w-4" />
				</button>
			</div>
			<div class="flex-1 overflow-y-auto p-4">
				<ShelterFilterPanel
					{filters}
					{availableTypes}
					action="/shelters"
					bind:userLat
					bind:userLng
					idPrefix="mobile-"
					class="h-auto max-h-none border-0 bg-transparent p-0 shadow-none"
					onClose={() => (open = false)}
				/>
			</div>
		</div>
	</div>
{/if}
