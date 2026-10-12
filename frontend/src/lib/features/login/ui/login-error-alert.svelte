<script lang="ts">
	import * as Alert from '$lib/components/ui/alert/index.js';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import type { LoginErrorView } from '../domain/errors';

	let { error }: { error: LoginErrorView } = $props();
</script>

<Alert.Root
	variant="destructive"
	class="border-destructive/40 bg-destructive/5"
	aria-live="assertive"
>
	<CircleAlert />
	<Alert.Title class="font-semibold whitespace-normal">{error.title}</Alert.Title>
	{#if error.hints?.length}
		<Alert.Description>
			<p>กรุณาตรวจสอบว่า:</p>
			<ul class="list-disc space-y-0.5 pl-4">
				{#each error.hints as hint (hint)}
					<li>{hint}</li>
				{/each}
			</ul>
		</Alert.Description>
	{/if}
</Alert.Root>
