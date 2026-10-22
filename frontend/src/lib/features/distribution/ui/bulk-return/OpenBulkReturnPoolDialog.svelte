<script lang="ts">
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { StoragePointSelect, useStoragePoints } from '$lib/features/operations';
	import { createStableOperationId, useOpenBulkReturnPool } from '../../application/queries';
	import { BulkReturnPoolNameTakenError } from '../../application/food-supplies/errors';
	import type { BulkReturnPoolV3 } from '../../domain/food-supplies';
	import { formatDistributionError } from '../model/distribution-error';
	import {
		BULK_RETURN_POOL_NAME_MAX_LENGTH,
		findDuplicateOpenPoolName,
		validatePoolName,
		type BulkReturnPoolRow
	} from '../model/bulk-return-pool-v3';

	/**
	 * Mounted by the parent only while the dialog should be visible (`{#if}`), so every open starts
	 * from a clean form and a fresh operation ULID.
	 */
	interface Props {
		shelterCode: string;
		/** Current overview rows, used for the advisory duplicate-name warning. */
		rows: readonly BulkReturnPoolRow[];
		onClose: () => void;
		onOpened?: (pool: BulkReturnPoolV3) => void;
	}

	let { shelterCode, rows, onClose, onOpened }: Props = $props();

	const openMutation = useOpenBulkReturnPool();
	const storagePoints = useStoragePoints(() => shelterCode);

	let open = $state(true);
	let name = $state('');
	let storagePointId = $state('');
	let notes = $state('');
	let attempted = $state(false);
	// Server "name taken" rejection, remembered with the name it was raised for (stale once edited).
	let serverNameRejection = $state<{ name: string; message: string } | null>(null);
	let submitError = $state<string | null>(null);
	// Created once per user action and reused when the same submit is retried after a failure.
	let operationUlid: string | null = null;

	const nameValidation = $derived(validatePoolName(name));
	const serverNameError = $derived(
		serverNameRejection && serverNameRejection.name === name ? serverNameRejection.message : null
	);
	const nameError = $derived(
		serverNameError ?? (attempted && !nameValidation.isValid ? nameValidation.error : null)
	);
	const duplicate = $derived(findDuplicateOpenPoolName(rows, name));
	const selectedPoint = $derived(storagePoints.points.find((p) => p.id === storagePointId) ?? null);

	function handleOpenChange(next: boolean) {
		if (!next) onClose();
	}

	async function handleSubmit() {
		attempted = true;
		serverNameRejection = null;
		submitError = null;
		if (!nameValidation.isValid || !nameValidation.normalized) return;

		operationUlid ??= createStableOperationId();
		const trimmedNotes = notes.trim();

		try {
			const pool = await openMutation.mutateAsync({
				input: {
					name: nameValidation.normalized,
					storagePoint: selectedPoint ? { id: selectedPoint.id, name: selectedPoint.name } : null,
					...(trimmedNotes ? { notes: trimmedNotes } : {})
				},
				operationUlid,
				shelterCode
			});
			operationUlid = null;
			toast.success(`เปิดกอง "${pool.name}" เรียบร้อยแล้ว`);
			onOpened?.(pool);
			open = false;
			onClose();
		} catch (err) {
			const message = formatDistributionError(err, 'เปิดกองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
			if (err instanceof BulkReturnPoolNameTakenError) {
				serverNameRejection = { name, message };
			} else {
				submitError = message;
			}
			toast.error(message);
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-[560px]">
		<div class="border-b border-slate-100 bg-slate-50 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2.5 text-lg font-bold text-slate-900">
					<span
						class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-2xs"
					>
						<PackagePlus class="h-5 w-5" aria-hidden="true" />
					</span>
					<span>เปิดกองใหม่</span>
				</Dialog.Title>
				<Dialog.Description class="mt-1 text-sm text-slate-600">
					เปิดกองรับคืนเปล่าไว้ก่อน แล้วค่อยบันทึกของที่รับคืนเข้ากองภายหลัง (ยังไม่ต้องระบุจำนวน)
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
						class="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-900"
					>
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
						<div>
							<p class="font-semibold">{submitError}</p>
							<p class="mt-0.5 text-xs text-red-800">
								ข้อมูลที่กรอกยังอยู่ครบ กดลองใหม่ได้ทันที ระบบจะไม่เปิดกองซ้ำ
							</p>
						</div>
					</div>
				{/if}

				<div class="space-y-1.5">
					<div class="flex items-baseline justify-between gap-2">
						<Label for="open-pool-name" class="text-sm font-semibold text-slate-700">
							ชื่อกอง <span class="text-red-600">*</span>
						</Label>
						<span
							class="text-xs tabular-nums {name.trim().length > BULK_RETURN_POOL_NAME_MAX_LENGTH
								? 'font-semibold text-red-700'
								: 'text-slate-500'}"
						>
							{name.trim().length}/{BULK_RETURN_POOL_NAME_MAX_LENGTH}
						</span>
					</div>
					<Input
						id="open-pool-name"
						bind:value={name}
						maxlength={BULK_RETURN_POOL_NAME_MAX_LENGTH}
						placeholder="เช่น กองรับคืนเต็นท์ A"
						autocomplete="off"
						aria-invalid={nameError ? true : undefined}
						aria-describedby={nameError ? 'open-pool-name-error' : undefined}
						class="h-11 text-base sm:h-10 sm:text-sm"
					/>
					{#if nameError}
						<p id="open-pool-name-error" role="alert" class="text-sm font-medium text-red-700">
							{nameError}
						</p>
					{/if}
					{#if duplicate && !serverNameError}
						<p
							class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-amber-900"
						>
							<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
							<span>มีกองที่เปิดรับอยู่ใช้ชื่อนี้แล้ว ควรตั้งชื่ออื่นเพื่อไม่ให้สับสน</span>
						</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<Label for="open-pool-location" class="text-sm font-semibold text-slate-700">
						จุดที่ตั้ง (ไม่บังคับ)
					</Label>
					<StoragePointSelect
						id="open-pool-location"
						points={storagePoints.points}
						bind:value={storagePointId}
					/>
				</div>

				<div class="space-y-1.5">
					<Label for="open-pool-notes" class="text-sm font-semibold text-slate-700">
						หมายเหตุ (ไม่บังคับ)
					</Label>
					<Textarea
						id="open-pool-notes"
						bind:value={notes}
						rows={3}
						placeholder="เช่น รวบรวมของคืนจากโซน B ช่วงเช้า"
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
					disabled={openMutation.isPending}
					class="min-h-11 w-full sm:w-auto"
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					disabled={openMutation.isPending}
					class="min-h-11 w-full gap-2 sm:w-auto"
				>
					{#if openMutation.isPending}
						<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
						<span>กำลังเปิดกอง...</span>
					{:else}
						<PackagePlus class="h-4 w-4" aria-hidden="true" />
						<span>เปิดกอง</span>
					{/if}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
