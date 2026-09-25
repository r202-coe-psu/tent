<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Copy from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import {
		partnerModuleLabel,
		thirdPartyClientDisplayName,
		type CreatedThirdPartyClient
	} from '../domain/third-party-client';

	let {
		open = $bindable(false),
		created = null
	}: {
		open?: boolean;
		created?: CreatedThirdPartyClient | null;
	} = $props();

	async function copyValue(value: string | undefined, label: string) {
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`${label} copied to clipboard`);
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
			<Dialog.Title class="text-xl">Copy the client credentials</Dialog.Title>
			<Dialog.Description class="mt-1.5">
				This is the only time the full secret is shown. Copy it now and store it securely.
			</Dialog.Description>
		</div>
		{#if created}
			<div class="grid gap-4 p-6">
				<div class="grid gap-1 text-sm">
					<span class="font-semibold text-foreground">{thirdPartyClientDisplayName(created)}</span>
					<span class="text-muted-foreground"
						>Module: {partnerModuleLabel(created.module_name)}</span
					>
				</div>
				<div class="grid gap-1.5">
					<span class="text-xs font-semibold text-muted-foreground">Client ID</span>
					<div
						class="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm break-all"
					>
						<span class="flex-1 select-all">{created.client_id}</span>
						<Button
							type="button"
							variant="secondary"
							size="icon"
							class="shrink-0"
							onclick={() => copyValue(created?.client_id, 'Client ID')}
							aria-label="Copy client ID"
						>
							<Copy class="h-4 w-4" />
						</Button>
					</div>
				</div>
				<div class="grid gap-1.5">
					<span class="text-xs font-semibold text-muted-foreground">Client secret</span>
					<div
						class="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm break-all"
					>
						<span class="flex-1 select-all">{created.client_secret}</span>
						<Button
							type="button"
							variant="secondary"
							size="icon"
							class="shrink-0"
							onclick={() => copyValue(created?.client_secret, 'Client secret')}
							aria-label="Copy client secret"
						>
							<Copy class="h-4 w-4" />
						</Button>
					</div>
				</div>
				<p class="text-xs text-muted-foreground">
					Exchange <code class="rounded bg-muted px-1">client_id</code> +
					<code class="rounded bg-muted px-1">client_secret</code> at
					<code class="rounded bg-muted px-1">POST /external/token</code>
					(<code class="rounded bg-muted px-1">grant_type=client_credentials</code>).
				</p>
			</div>
		{/if}
		<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 p-4">
			<Button onclick={() => handleOpenChange(false)}>Done</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
