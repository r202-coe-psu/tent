<script lang="ts">
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		pending = false,
		label,
		submittingLabel,
		align = 'right',
		/** When false, parent owns sticky positioning (e.g. bottom chrome dock). */
		sticky = true
	}: {
		pending?: boolean;
		label: string;
		submittingLabel: string;
		align?: 'right' | 'center';
		sticky?: boolean;
	} = $props();
</script>

<div
	class="{sticky
		? 'sticky bottom-0 z-30 -mx-1 border-t border-border bg-background/95 px-3 py-3.5 backdrop-blur-sm sm:px-4'
		: 'px-0 pt-2 pb-0'} {align === 'center'
		? 'flex items-center justify-center'
		: 'flex items-center justify-end'}"
>
	<Button
		type="submit"
		disabled={pending}
		class="h-11 w-full gap-2 rounded-xl text-base font-semibold shadow-xs sm:w-auto sm:min-w-56 sm:px-8"
	>
		{#if pending}
			<Loader2 class="size-4 animate-spin" />
			{submittingLabel}
		{:else}
			{label}
		{/if}
	</Button>
</div>
