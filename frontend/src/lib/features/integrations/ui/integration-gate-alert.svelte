<script lang="ts">
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';

	let {
		title,
		description,
		checking = false,
		onRetry
	}: {
		title: string;
		description?: string;
		checking?: boolean;
		onRetry: () => void;
	} = $props();
</script>

<Alert.Root
	class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900"
>
	<CloudOff class="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
	<div class="min-w-0 flex-1 space-y-1">
		<Alert.Title class="text-sm font-semibold">{title}</Alert.Title>
		{#if description}
			<Alert.Description class="text-sm text-amber-900">{description}</Alert.Description>
		{/if}
	</div>
	<Button
		variant="outline"
		size="sm"
		class="h-11 shrink-0 gap-2 border-amber-300 bg-white sm:h-9"
		disabled={checking}
		onclick={onRetry}
	>
		<RotateCw class="h-4 w-4 {checking ? 'animate-spin' : ''}" aria-hidden="true" />
		ลองใหม่
	</Button>
</Alert.Root>
