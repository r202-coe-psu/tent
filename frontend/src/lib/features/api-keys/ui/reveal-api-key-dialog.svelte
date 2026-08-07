<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Copy from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import type { CreatedApiKey } from '../domain/api-key';

	let {
		open = $bindable(false),
		created = null
	}: {
		open?: boolean;
		created?: CreatedApiKey | null;
	} = $props();

	async function copyKey() {
		const secret = created?.api_key;
		if (!secret) return;
		try {
			await navigator.clipboard.writeText(secret);
			toast.success('API key copied to clipboard');
		} catch {
			toast.error('Could not copy to clipboard');
		}
	}

	function handleOpenChange(next: boolean) {
		open = next;
	}
</script>

<Dialog.Root bind:open={() => open, handleOpenChange}>
	<Dialog.Content class="overflow-hidden p-0 sm:max-w-[520px]">
		<div class="border-b border-border bg-muted/30 p-6 pb-4">
			<Dialog.Title class="text-xl">Copy your API key</Dialog.Title>
			<Dialog.Description class="mt-1.5">
				This is the only time the full key is shown. Copy it now and store it securely.
			</Dialog.Description>
		</div>
		{#if created}
			<div class="grid gap-4 p-6">
				<div class="grid gap-1 text-sm">
					<span class="font-semibold text-foreground">{created.name}</span>
					<span class="text-muted-foreground">Owner: {created.owner}</span>
				</div>
				<div
					class="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm break-all"
				>
					<span class="flex-1 select-all">{created.api_key}</span>
					<Button
						type="button"
						variant="secondary"
						size="icon"
						class="shrink-0"
						onclick={copyKey}
						aria-label="Copy API key"
					>
						<Copy class="h-4 w-4" />
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					Send as <code class="rounded bg-muted px-1">X-API-Key</code> on
					<code class="rounded bg-muted px-1">/external/v1/*</code> requests.
				</p>
			</div>
		{/if}
		<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 p-4">
			<Button onclick={() => handleOpenChange(false)}>Done</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
