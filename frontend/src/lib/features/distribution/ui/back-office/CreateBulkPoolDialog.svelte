<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import { toast } from 'svelte-sonner';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import Package from '@lucide/svelte/icons/package';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import X from '@lucide/svelte/icons/x';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { ulid } from '$lib/db/ulid';
	import { useItemMasters } from '$lib/features/catalog';
	import { useCreateBulkReturnPool } from '../../application/queries';
	import type { BulkReturnPool } from '../../domain/food-supplies';
	import {
		buildCreateBulkPoolInput,
		isEligibleBulkPoolItem,
		validateCreateBulkPoolForm
	} from '../model/bulk-pool-manager';
	import { getReturnableBadgeClass, getReturnableBadgeLabel } from '../model/catalog-eligibility';
	import { formatDistributionError } from '../model/distribution-error';

	interface Props {
		open?: boolean;
		shelterCode: string;
		onSuccess?: (pool: BulkReturnPool) => void;
		onClose?: () => void;
	}

	let { open = $bindable(false), shelterCode, onSuccess, onClose }: Props = $props();

	const createMutation = useCreateBulkReturnPool();
	const itemMastersQuery = useItemMasters(() => shelterCode ?? null);

	// Session state — stable operationUlid preserved across failed submits/retries
	let operationUlid = $state<string | null>(null);
	let selectedItemId = $state('');
	let receivedQty = $state('');
	let notes = $state('');
	let submitError = $state<string | null>(null);

	function ensureOperationUlid(): string {
		if (!operationUlid) {
			operationUlid = ulid();
		}
		return operationUlid;
	}

	function resetForm() {
		operationUlid = null;
		selectedItemId = '';
		receivedQty = '';
		notes = '';
		submitError = null;
	}

	$effect(() => {
		if (open) {
			if (!operationUlid) {
				ensureOperationUlid();
			}
		} else {
			resetForm();
		}
	});

	const allItems = $derived(itemMastersQuery.data ?? []);
	const eligibleItems = $derived(allItems.filter((item) => isEligibleBulkPoolItem(item)));

	// Item shape fed into the shared Combobox — value stays the canonical item._id.
	// Search (name + SKU) is handled by Combobox's own keyword-matching internally.
	const comboboxItems = $derived(
		eligibleItems.map((item) => ({
			value: item._id,
			label: item.name,
			sku: item.sku,
			returnable: item.returnable
		}))
	);

	const selectedItem = $derived(allItems.find((item) => item._id === selectedItemId) ?? null);

	const validation = $derived(validateCreateBulkPoolForm(selectedItemId, receivedQty));

	const canSubmit = $derived(
		Boolean(
			selectedItemId &&
			receivedQty.trim() &&
			!createMutation.isPending &&
			!itemMastersQuery.isError &&
			!itemMastersQuery.isLoading
		)
	);

	async function handleSubmit() {
		submitError = null;
		if (!validation.isValid || !validation.normalizedQty) {
			const message = validation.error ?? 'กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง';
			submitError = message;
			toast.error(message);
			return;
		}

		const token = ensureOperationUlid();
		const payload = buildCreateBulkPoolInput({
			operationUlid: token,
			itemId: selectedItemId,
			totalReceivedQty: validation.normalizedQty,
			notes
		});

		try {
			const pool = await createMutation.mutateAsync({
				input: payload,
				shelterCode
			});

			toast.success('เปิดจุดรวมคืนพัสดุเรียบร้อยแล้ว');
			resetForm();
			open = false;
			onSuccess?.(pool);
		} catch (err) {
			// CRITICAL: Preserve form state and operationUlid on failure so user can retry safely
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการสร้างจุดรวมคืน กรุณาลองใหม่อีกครั้ง'
			);
			submitError = msg;
			toast.error(msg);
		}
	}

	function handleClose() {
		resetForm();
		open = false;
		onClose?.();
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) {
			handleClose();
		}
	}}
>
	<Dialog.Content class="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-[620px]">
		<!-- Header -->
		<div class="border-b border-slate-100 bg-violet-50/60 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2.5 text-lg font-bold text-slate-900">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-200 bg-white text-violet-700 shadow-2xs"
					>
						<PackagePlus class="h-5 w-5" aria-hidden="true" />
					</div>
					<span>เปิดจุดรวมคืนพัสดุ (Bulk Return Pool)</span>
				</Dialog.Title>
				<Dialog.Description class="mt-1 text-xs text-slate-600">
					บันทึกการรับคืนพัสดุกองรวมเข้าคลัง เพื่อเปิดโควตาสำหรับตัดรอบคืนของศูนย์ {shelterCode}
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<!-- Body -->
		<div class="flex-1 space-y-5 overflow-y-auto p-6">
			<!-- Error Banner if failed -->
			{#if submitError}
				<div class="rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-xs text-red-900">
					<div class="flex items-start gap-2">
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
						<div class="flex-1">
							<p class="font-bold">เกิดข้อผิดพลาดในการเปิดจุดรวมคืน</p>
							<p class="mt-0.5 text-red-800">{submitError}</p>
							<p class="mt-1 text-2xs text-red-600">
								ข้อมูลและรหัสรายการ (ID) ถูกเก็บรักษาไว้แล้ว สามารถกดลองใหม่ได้ทันที
							</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Item Selection -->
			<div class="space-y-2">
				<label for="bulk-pool-item-search" class="block text-xs font-bold text-slate-700">
					สินค้าที่รับคืน <span class="text-red-500">*</span>
				</label>

				{#if selectedItem}
					<!-- Selected Item Card -->
					<div
						class="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50/40 p-3 text-xs"
					>
						<div class="flex items-center gap-3">
							<div
								class="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-200 bg-white text-violet-700 shadow-2xs"
							>
								<Package class="h-5 w-5" aria-hidden="true" />
							</div>
							<div>
								<div class="font-bold text-slate-900">{selectedItem.name}</div>
								<div class="font-mono text-2xs text-slate-500">
									ID: {selectedItem._id}
									{#if selectedItem.sku}
										• SKU: {selectedItem.sku}
									{/if}
								</div>
							</div>
						</div>
						<div class="flex items-center gap-2">
							<span
								class="inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-semibold {getReturnableBadgeClass(
									selectedItem.returnable
								)}"
							>
								{getReturnableBadgeLabel(selectedItem.returnable)}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onclick={() => (selectedItemId = '')}
								title="เปลี่ยนสินค้า"
								aria-label="เปลี่ยนสินค้า"
								class="text-slate-400 hover:bg-white hover:text-slate-700"
							>
								<X class="h-4 w-4" aria-hidden="true" />
							</Button>
						</div>
					</div>
				{:else if itemMastersQuery.isLoading}
					<div
						class="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xs"
					>
						<div class="p-6 text-center text-xs text-slate-500">
							<Loader2 class="mx-auto mb-1 h-5 w-5 animate-spin text-slate-400" />
							กำลังโหลดรายการสินค้า...
						</div>
					</div>
				{:else if itemMastersQuery.isError}
					<div
						class="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xs"
					>
						<div class="p-6 text-center text-xs text-red-600">
							<AlertCircle class="mx-auto mb-1 h-5 w-5 text-red-500" />
							<p class="font-semibold">ไม่สามารถโหลดรายการสินค้าได้</p>
							<p class="mt-0.5 text-2xs text-red-500">
								กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง
							</p>
							<Button
								type="button"
								variant="outline"
								onclick={() => itemMastersQuery.refetch()}
								class="mt-2 border-red-200 text-2xs font-semibold text-red-700 hover:bg-red-50"
							>
								<RefreshCw class="h-3 w-3" />
								ลองใหม่
							</Button>
						</div>
					</div>
				{:else}
					<!-- Item Search + Selection (shared Combobox) -->
					<Combobox
						items={comboboxItems}
						bind:value={selectedItemId}
						placeholder="เลือกสินค้าที่ต้องการรับคืน..."
						searchPlaceholder="ค้นหาชื่อสินค้า หรือ SKU..."
						emptyText={eligibleItems.length === 0
							? 'ไม่มีรายการสินค้าที่สามารถเปิดจุดรวมคืนได้ในศูนย์นี้'
							: 'ไม่พบสินค้าบรรเทาทุกข์ที่ตรงกับการค้นหา'}
						controlProps={{ id: 'bulk-pool-item-search' }}
						class="h-9 w-full text-xs shadow-2xs"
					>
						{#snippet children({ item })}
							<div class="flex w-full min-w-0 items-center justify-between gap-2">
								<div class="min-w-0">
									<div class="truncate font-semibold text-slate-900">{item.label}</div>
									{#if item.sku}
										<div class="font-mono text-2xs text-slate-500">SKU: {item.sku}</div>
									{/if}
								</div>
								<span
									class="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-2xs font-semibold {getReturnableBadgeClass(
										item.returnable
									)}"
								>
									{getReturnableBadgeLabel(item.returnable)}
								</span>
							</div>
						{/snippet}
					</Combobox>
				{/if}
			</div>

			<!-- Received Quantity Input -->
			<div class="space-y-1.5">
				<label for="bulk-pool-qty" class="block text-xs font-bold text-slate-700">
					จำนวนที่รับคืนเข้ารวม ({selectedItem?.base_unit ?? 'ชิ้น'})
					<span class="text-red-500">*</span>
				</label>
				<Input
					id="bulk-pool-qty"
					type="text"
					inputmode="numeric"
					step="1"
					value={receivedQty}
					oninput={(event) => (receivedQty = event.currentTarget.value)}
					placeholder="เช่น 10, 50, 100"
					class="h-9 w-full font-mono text-xs shadow-2xs placeholder:text-slate-400"
				/>
				<p class="text-2xs text-slate-500">
					ระบบจะบันทึกรับเข้าคลัง 1 รายการ และตั้งต้นโควตาคงเหลือเท่ากับจำนวนนี้
				</p>
			</div>

			<!-- Optional Notes -->
			<div class="space-y-1.5">
				<label for="bulk-pool-notes" class="block text-xs font-bold text-slate-700">
					หมายเหตุ / ที่มาของการรับคืน (ไม่บังคับ)
				</label>
				<Textarea
					id="bulk-pool-notes"
					rows={2}
					value={notes}
					oninput={(event) => (notes = event.currentTarget.value)}
					placeholder="ระบุจุดที่รวบรวมของคืน เช่น กองรับคืนเต็นท์ A, เก็บกู้จากหน้างาน..."
					class="w-full text-xs shadow-2xs placeholder:text-slate-400"
				/>
			</div>
		</div>

		<!-- Footer -->
		<div
			class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4"
		>
			<Button
				type="button"
				variant="outline"
				onclick={handleClose}
				disabled={createMutation.isPending}
				class="text-xs font-semibold"
			>
				ยกเลิก
			</Button>
			<Button
				type="button"
				variant="default"
				onclick={handleSubmit}
				disabled={!canSubmit}
				class="bg-violet-700 text-xs font-semibold hover:bg-violet-800"
			>
				{#if createMutation.isPending}
					<Loader2 class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					<span>กำลังบันทึกรับเข้าคลัง...</span>
				{:else}
					<PackagePlus class="h-3.5 w-3.5" aria-hidden="true" />
					<span>เปิดจุดรวมคืนพัสดุ</span>
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
