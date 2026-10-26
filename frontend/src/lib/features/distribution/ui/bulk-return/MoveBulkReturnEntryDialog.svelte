<script lang="ts">
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { useMoveBulkReturnEntry } from '../../application/queries';
	import type { BulkReturnEntry, BulkReturnPoolV3 } from '../../domain/food-supplies';
	import { formatDistributionError } from '../model/distribution-error';
	import type { ItemDisplay } from '../model/bulk-return-pool-v3';

	/** Mounted by the parent only while visible (`{#if}`) so each open starts clean. */
	interface Props {
		entry: BulkReturnEntry;
		item: ItemDisplay;
		fromPoolName: string;
		/** Late entry: its loans were never applied and are cleared by the move. */
		late: boolean;
		/** OPEN, unlocked pools other than the source (see `listMoveTargets`). */
		targets: readonly BulkReturnPoolV3[];
		shelterCode: string;
		onClose: () => void;
	}

	let { entry, item, fromPoolName, late, targets, shelterCode, onClose }: Props = $props();

	const moveMutation = useMoveBulkReturnEntry();

	let open = $state(true);
	let toPoolId = $state('');
	let notes = $state('');
	let submitError = $state<string | null>(null);

	const selectedTarget = $derived(targets.find((pool) => pool._id === toPoolId) ?? null);

	function handleOpenChange(next: boolean) {
		if (!next) onClose();
	}

	async function handleSubmit() {
		submitError = null;
		if (!selectedTarget) {
			submitError = 'กรุณาเลือกกองปลายทาง';
			return;
		}
		const trimmedNotes = notes.trim();
		try {
			const result = await moveMutation.mutateAsync({
				input: {
					entry_id: entry._id,
					to_pool_id: selectedTarget._id,
					...(trimmedNotes ? { notes: trimmedNotes } : {})
				},
				shelterCode
			});
			if (result.late) {
				toast.warning(
					`ย้ายไปกอง "${selectedTarget.name}" แล้ว แต่กองนั้นเพิ่งปิดรับ รายการนี้จึงค้างอีกครั้ง กรุณาย้ายไปกองอื่นที่ยังเปิดอยู่`
				);
			} else {
				const appliedCount = result.loansApplied.length;
				toast.success(
					`ย้ายรายการไปกอง "${selectedTarget.name}" เรียบร้อยแล้ว${
						appliedCount > 0 ? ` · ตัดยอดยืม ${appliedCount} รายการ` : ''
					}`
				);
			}
			open = false;
			onClose();
		} catch (err) {
			const message = formatDistributionError(err, 'ย้ายรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
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
						<ArrowRightLeft class="h-5 w-5" aria-hidden="true" />
					</span>
					<span>ย้ายไปกองอื่น</span>
				</Dialog.Title>
				<Dialog.Description class="mt-1 text-sm text-slate-600">
					ย้าย <span class="font-semibold tabular-nums">{item.name} {entry.qty} {item.unit}</span>
					จากกอง "{fromPoolName}" ไปยังกองที่ยังเปิดรับอยู่
					{#if late}
						เมื่อย้ายแล้วระบบจะตัดยอดยืมของผู้คืนสำหรับรายการนี้
					{:else}
						(ยอดยืมของผู้คืนไม่เปลี่ยน)
					{/if}
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
					<Label for="move-entry-target" class="text-sm font-semibold text-slate-700">
						กองปลายทาง <span class="text-red-600">*</span>
					</Label>
					{#if targets.length === 0}
						<p
							class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900"
						>
							ยังไม่มีกองอื่นที่เปิดรับอยู่ กรุณาเปิดกองใหม่ก่อนจึงจะย้ายรายการได้
						</p>
					{:else}
						<Select.Root type="single" bind:value={toPoolId}>
							<Select.Trigger
								id="move-entry-target"
								class="h-11 w-full min-w-0 bg-white text-sm font-medium data-[size=default]:h-11 sm:h-10 sm:data-[size=default]:h-10"
							>
								<span class="truncate">
									{selectedTarget ? selectedTarget.name : 'เลือกกองปลายทาง'}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each targets as pool (pool._id)}
									<Select.Item value={pool._id} label={pool.name} />
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
				</div>

				<div class="space-y-1.5">
					<Label for="move-entry-notes" class="text-sm font-semibold text-slate-700">
						หมายเหตุ (ไม่บังคับ)
					</Label>
					<Textarea
						id="move-entry-notes"
						bind:value={notes}
						rows={2}
						placeholder="เช่น ย้ายเพราะกองเดิมปิดรับแล้ว"
						class="w-full text-base sm:text-sm"
					/>
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
					disabled={moveMutation.isPending}
					class="min-h-11 w-full sm:w-auto"
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					disabled={moveMutation.isPending || !selectedTarget}
					class="min-h-11 w-full gap-2 sm:w-auto"
				>
					{#if moveMutation.isPending}
						<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
						<span>กำลังย้าย...</span>
					{:else}
						<ArrowRightLeft class="h-4 w-4" aria-hidden="true" />
						<span>ย้ายรายการ</span>
					{/if}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
