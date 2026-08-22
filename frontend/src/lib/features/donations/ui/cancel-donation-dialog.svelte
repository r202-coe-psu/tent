<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import { useCancelDonation } from '../application/queries';

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

	const cancelMutation = useCancelDonation();

	function handleOpenChange(next: boolean) {
		open = next;
	}

	function confirmCancel() {
		cancelMutation.mutate(
			{ token },
			{
				onSuccess: () => {
					toast.success('ยกเลิกการจองบริจาคแล้ว — คืนสิทธิ์ให้ผู้บริจาคท่านอื่น');
					open = false;
					onCancelled?.();
				},
				onError: (err) => {
					toast.error(err instanceof Error ? err.message : 'ยกเลิกการจองไม่สำเร็จ');
				}
			}
		);
	}
</script>

<AlertDialog.Root bind:open={() => open, handleOpenChange}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ยกเลิกการจองบริจาคนี้?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if bookingRef}
					รายการ <span class="font-bold text-foreground">{bookingRef}</span> จะถูกยกเลิก
				{:else}
					รายการจองนี้จะถูกยกเลิก
				{/if}
				และจำนวนที่จองไว้จะถูกคืนให้ผู้บริจาคท่านอื่นทันที การยกเลิกนี้ย้อนกลับไม่ได้ หากยังต้องการบริจาคต้องจองคิวใหม่
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={cancelMutation.isPending}>ไม่ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				onclick={(e) => {
					e.preventDefault();
					confirmCancel();
				}}
				disabled={cancelMutation.isPending}
			>
				{#if cancelMutation.isPending}
					กำลังยกเลิก…
				{:else}
					ยืนยันยกเลิกการจอง
				{/if}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
