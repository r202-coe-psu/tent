<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import type { ThirdPartyClient } from '../domain/third-party-client';
	import { useRevokeThirdPartyClient } from '../application/queries';

	let {
		open = $bindable(false),
		target = null
	}: {
		open?: boolean;
		target?: ThirdPartyClient | null;
	} = $props();

	const revokeMutation = useRevokeThirdPartyClient();

	function handleOpenChange(next: boolean) {
		open = next;
	}

	function confirmRevoke() {
		if (!target) return;
		revokeMutation.mutate(target.id, {
			onSuccess: () => {
				toast.success('Third-party client revoked');
				open = false;
			},
			onError: (err) => {
				toast.error(err instanceof Error ? err.message : 'Failed to revoke client');
			}
		});
	}
</script>

<AlertDialog.Root bind:open={() => open, handleOpenChange}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Revoke third-party client?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if target}
					Revoking <code class="text-xs">{target.client_id}</code> immediately blocks it from minting
					new tokens. Any token already issued stays valid until it naturally expires (up to 3,600s later).
					This cannot be undone.
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
					Revoke client
				{/if}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
