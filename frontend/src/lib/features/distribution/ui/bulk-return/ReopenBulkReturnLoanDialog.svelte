<script lang="ts">
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { useReopenBulkReturnEntryLoans } from '../../application/queries';
	import {
		BULK_RETURN_LOAN_REOPEN_REASON_MAX,
		type BulkReturnEntry
	} from '../../domain/food-supplies';
	import { formatDistributionError } from '../model/distribution-error';
	import {
		REOPEN_LOAN_ACTION,
		REOPEN_LOAN_CONFIRM,
		REOPEN_LOAN_DESCRIPTION,
		REOPEN_LOAN_ERROR,
		REOPEN_LOAN_REASON_LABEL,
		REOPEN_LOAN_REPLAYED_TOAST,
		REOPEN_LOAN_SKIPPED_TOAST,
		reopenLoanSuccessToast,
		type ItemDisplay
	} from '../model/bulk-return-pool-v3';

	/** Mounted by the parent only while visible (`{#if}`) so each open starts clean. */
	interface Props {
		entry: BulkReturnEntry;
		item: ItemDisplay;
		returnerName: string;
		shelterCode: string;
		onClose: () => void;
	}

	let { entry, item, returnerName, shelterCode, onClose }: Props = $props();

	const reopenMutation = useReopenBulkReturnEntryLoans();

	let open = $state(true);
	let reason = $state('');
	let submitError = $state<string | null>(null);

	const trimmedReason = $derived(reason.trim());
	const canSubmit = $derived(trimmedReason.length > 0 && !reopenMutation.isPending);

	function handleOpenChange(next: boolean) {
		if (!next) onClose();
	}

	async function handleSubmit() {
		if (!canSubmit) return;
		submitError = null;
		try {
			const result = await reopenMutation.mutateAsync({
				input: { entry_id: entry._id, reason: trimmedReason },
				shelterCode
			});
			const reopened = result.loansReopened.length;
			if (result.replayed && reopened === 0) {
				toast.info(REOPEN_LOAN_REPLAYED_TOAST);
			} else {
				toast.success(reopenLoanSuccessToast(reopened));
			}
			if (result.loansSkipped.length > 0) toast.warning(REOPEN_LOAN_SKIPPED_TOAST);
			open = false;
			onClose();
		} catch (err) {
			const message = formatDistributionError(err, REOPEN_LOAN_ERROR, { poolContext: 'reopen' });
			submitError = message;
			toast.error(message);
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-[520px]">
		<div class="border-b border-slate-100 bg-slate-50 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2.5 text-lg font-bold text-slate-900">
					<span
						class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-2xs"
					>
						<RotateCcw class="h-5 w-5" aria-hidden="true" />
					</span>
					<span>{REOPEN_LOAN_ACTION}</span>
				</Dialog.Title>
				<Dialog.Description class="mt-1 text-sm text-slate-600">
					{REOPEN_LOAN_DESCRIPTION}
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<form
			class="flex min-h-0 flex-1 flex-col"
			onsubmit={(event) => {
				event.preventDefault();
				void handleSubmit();
			}}
		>
			<div class="flex-1 space-y-5 overflow-y-auto p-6">
				<div class="space-y-0.5 rounded-xl border border-slate-200/80 bg-white p-3.5 text-sm">
					<p class="font-semibold break-words text-slate-900 tabular-nums">
						{item.name}
						{entry.qty}
						{item.unit}
					</p>
					<p class="text-slate-600">
						ผู้คืน: <span class="font-medium text-slate-800">{returnerName}</span>
					</p>
				</div>

				{#if submitError}
					<div
						role="alert"
						class="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-semibold text-red-900"
					>
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
						<p>{submitError}</p>
					</div>
				{/if}

				<div class="space-y-1.5">
					<Label for="reopen-loan-reason" class="text-sm font-semibold text-slate-700">
						{REOPEN_LOAN_REASON_LABEL} <span class="text-red-600">*</span>
					</Label>
					<Textarea
						id="reopen-loan-reason"
						bind:value={reason}
						rows={3}
						maxlength={BULK_RETURN_LOAN_REOPEN_REASON_MAX}
						required
						class="w-full text-base sm:text-sm"
					/>
					<p class="text-right text-xs text-slate-500 tabular-nums">
						{reason.length}/{BULK_RETURN_LOAN_REOPEN_REASON_MAX}
					</p>
				</div>
			</div>

			<div
				class="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end"
			>
				<Button
					type="button"
					variant="outline"
					onclick={() => {
						open = false;
						onClose();
					}}
					disabled={reopenMutation.isPending}
					class="min-h-11 w-full sm:w-auto"
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					variant="destructive"
					disabled={!canSubmit}
					class="min-h-11 w-full gap-2 sm:w-auto"
				>
					{#if reopenMutation.isPending}
						<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
					{/if}
					<span>{REOPEN_LOAN_CONFIRM}</span>
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
