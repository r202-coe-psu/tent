<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import type { ApiKey } from '../domain/api-key';
	import { useRevokeApiKey } from '../application/queries';

	let {
		open = $bindable(false),
		target = null
	}: {
		open?: boolean;
		target?: ApiKey | null;
	} = $props();

	const revokeMutation = useRevokeApiKey();

	function handleOpenChange(next: boolean) {
		open = next;
	}

	function confirmRevoke() {
		if (!target) return;
		revokeMutation.mutate(target.id, {
			onSuccess: () => {
				toast.success('API key revoked');
				open = false;
			},
			onError: (err) => {
				toast.error(err instanceof Error ? err.message : 'Failed to revoke API key');
			}
		});
	}
</script>

<AlertDialog.Root bind:open={() => open, handleOpenChange}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Revoke API key?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if target}
					Revoking <span class="font-medium text-foreground">{target.name}</span>
					(<code class="text-xs">{target.key_prefix}</code>) immediately blocks
					<code class="text-xs">/external/v1/*</code> calls that use this key. This cannot be undone.
				{:else}
					This action cannot be undone.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={revokeMutation.isPending}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				onclick={(e) => {
					e.preventDefault();
					confirmRevoke();
				}}
				disabled={revokeMutation.isPending}
			>
				{#if revokeMutation.isPending}
					Revoking…
				{:else}
					Revoke key
				{/if}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
