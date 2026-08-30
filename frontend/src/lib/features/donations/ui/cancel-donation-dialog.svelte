<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import { useCancelDonation } from '../application/queries';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	let {
		open = $bindable(false),
		token,
		bookingRef = null,
		onCancelled
	}: {
		open?: boolean;
		token: string;
		bookingRef?: string | null;
		onCancelled?: () => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const cancelMutation = useCancelDonation();

	function handleOpenChange(next: boolean) {
		open = next;
	}

	function confirmCancel() {
		cancelMutation.mutate(
			{ token },
			{
				onSuccess: () => {
					toast.success(t.cancelSuccessToast);
					open = false;
					onCancelled?.();
				},
				onError: (err) => {
					toast.error(err instanceof Error ? err.message : t.cancelFailToast);
				}
			}
		);
	}
</script>

<AlertDialog.Root bind:open={() => open, handleOpenChange}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t.cancelDialogTitle}</AlertDialog.Title>
			<AlertDialog.Description>
				{#if bookingRef}
					{t.cancelDialogItemWillCancel.replace('{ref}', bookingRef)}
				{:else}
					{t.cancelDialogThisWillCancel}
				{/if}
				{t.cancelDialogDesc}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={cancelMutation.isPending}
				>{t.cancelDialogCancelBtn}</AlertDialog.Cancel
			>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				onclick={(e) => {
					e.preventDefault();
					confirmCancel();
				}}
				disabled={cancelMutation.isPending}
			>
				{#if cancelMutation.isPending}
					{t.cancelling}
				{:else}
					{t.cancelDialogConfirmBtn}
				{/if}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
