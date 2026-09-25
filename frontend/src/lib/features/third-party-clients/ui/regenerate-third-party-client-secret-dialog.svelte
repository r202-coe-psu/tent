<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import {
		thirdPartyClientDisplayName,
		type CreatedThirdPartyClient,
		type ThirdPartyClient
	} from '../domain/third-party-client';
	import { useRegenerateThirdPartyClientSecret } from '../application/queries';

	let {
		open = $bindable(false),
		target = null,
		onregenerated
	}: {
		open?: boolean;
		target?: ThirdPartyClient | null;
		onregenerated: (regenerated: CreatedThirdPartyClient) => void;
	} = $props();

	const regenerateMutation = useRegenerateThirdPartyClientSecret();

	function handleOpenChange(next: boolean) {
		open = next;
	}

	function confirmRegenerate() {
		if (!target) return;
		regenerateMutation.mutate(target.id, {
			onSuccess: (regenerated) => {
				toast.success('New secret generated');
				open = false;
				onregenerated(regenerated);
			},
			onError: (err) => {
				toast.error(err instanceof Error ? err.message : 'Failed to generate a new secret');
			}
		});
	}
</script>

<AlertDialog.Root bind:open={() => open, handleOpenChange}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Generate a new secret?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if target}
					This immediately invalidates the current secret for
					<code class="text-xs">{thirdPartyClientDisplayName(target)}</code> — any system still using
					the old secret will fail to authenticate until it's updated with the new one. The client ID
					stays the same. This cannot be undone.
				{:else}
					This cannot be undone.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={regenerateMutation.isPending}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				onclick={(e) => {
					e.preventDefault();
					confirmRegenerate();
				}}
				disabled={regenerateMutation.isPending}
			>
				{#if regenerateMutation.isPending}
					Generating…
				{:else}
					Generate new secret
				{/if}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
