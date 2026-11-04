<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import RejectReasonFields from './reject-reason-fields.svelte';
	import {
		rejectDonationInputSchema,
		type DonationRejectReasonCode,
		type RejectDonationInput
	} from '../domain/reject-reason';

	/**
	 * Reject a whole booking (CR-172 FR-6..FR-8) — used by the review queue and the scan
	 * station alike. The page owns the request; this only collects a valid reason.
	 */
	let {
		open = $bindable(false),
		bookingRef = '',
		pending = false,
		onconfirm
	}: {
		open?: boolean;
		bookingRef?: string;
		pending?: boolean;
		onconfirm: (input: RejectDonationInput) => void;
	} = $props();

	let code = $state<DonationRejectReasonCode>();
	let note = $state('');

	const parsed = $derived(rejectDonationInputSchema.safeParse({ reason_code: code, note }));

	function reset() {
		code = undefined;
		note = '';
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) reset();
	}

	function confirm() {
		if (!parsed.success || pending) return;
		onconfirm(parsed.data);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold">ปฏิเสธใบบริจาค</Dialog.Title>
			<Dialog.Description class="text-xs leading-relaxed">
				{#if bookingRef}
					<span class="font-bold text-foreground">{bookingRef}</span> ·
				{/if}
				ไม่รับของทั้งใบ — เลือกเหตุผลที่จะแจ้งผู้บริจาค
			</Dialog.Description>
		</Dialog.Header>

		<RejectReasonFields bind:code bind:note idPrefix="reject-donation" disabled={pending} />

		<Dialog.Footer class="gap-2">
			<Button
				variant="outline"
				class="text-xs font-bold"
				disabled={pending}
				onclick={() => handleOpenChange(false)}
			>
				ยกเลิก
			</Button>
			<Button
				variant="destructive"
				class="text-xs font-bold"
				disabled={!parsed.success || pending}
				onclick={confirm}
			>
				{pending ? 'กำลังบันทึก…' : 'ยืนยันปฏิเสธ'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
