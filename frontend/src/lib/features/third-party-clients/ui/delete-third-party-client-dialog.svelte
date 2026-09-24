<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import { thirdPartyClientDisplayName, type ThirdPartyClient } from '../domain/third-party-client';
	import { useDeleteThirdPartyClient } from '../application/queries';

	let {
		open = $bindable(false),
		target = null
	}: {
		open?: boolean;
		target?: ThirdPartyClient | null;
	} = $props();

	const deleteMutation = useDeleteThirdPartyClient();

	function handleOpenChange(next: boolean) {
		open = next;
	}

	function confirmDelete() {
		if (!target) return;
		deleteMutation.mutate(target.id, {
			onSuccess: () => {
				toast.success('Third-party client deleted');
				open = false;
			},
			onError: (err) => {
				toast.error(err instanceof Error ? err.message : 'Failed to delete client');
			}
		});
	}
</script>

<AlertDialog.Root bind:open={() => open, handleOpenChange}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete third-party client?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if target}
					Removes <code class="text-xs">{thirdPartyClientDisplayName(target)}</code> from this list. It
					stays revoked and cannot mint tokens either way — this only hides it, it is not removed from
					the database.
				{:else}
					This action cannot be undone from this screen.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleteMutation.isPending}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				onclick={(e) => {
					e.preventDefault();
					confirmDelete();
				}}
				disabled={deleteMutation.isPending}
			>
				{#if deleteMutation.isPending}
					Deleting…
				{:else}
					Delete client
				{/if}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
