<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import { Html5QrcodeSupportedFormats } from 'html5-qrcode';
	import CameraCodeScannerDialog from '$lib/components/camera-code-scanner-dialog.svelte';
	import { useItemMasters } from '$lib/features/catalog';
	import { formatThaiShortDate } from '$lib/utils/date';
	import {
		createStableOperationId,
		resolveAuthenticatedAuthorContext,
		useAddBulkReturnEntries,
		useBulkReturnPoolOverview,
		useReturnerOutstandingLoans
	} from '../../application/queries';
	import { canWriteBulkReturnEntry } from '../../application/food-supplies/auth';
	import RecipientSearchPicker from '../common/RecipientSearchPicker.svelte';
	import type { FrontlineRecipientSelection } from '../model/frontline-handover';
	import { formatDistributionError } from '../model/distribution-error';
	import { resolveItemDisplay } from '../model/bulk-return-pool-v3';
	import {
		LATE_RESULT_WARNING,
		NO_OUTSTANDING_LOAN_WARNING,
		addLine,
		buildAddEntriesInput,
		dropWrittenLines,
		filterEligibleItems,
		hasNoOutstandingLoanWarning,
		identifiedReturnerId,
		linesFromOutstandingLoans,
		listOpenPools,
		outstandingLoanRows,
		removeLine,
		resolveDefaultPoolId,
		resolveReturner,
		summarizeAddResult,
		validateAddEntryLines,
		type AddEntriesSummary,
		type AddEntryLine,
		type ReturnerChoice
	} from '../model/bulk-return-add-entry';
	import { parsePoolScanCode } from '../model/bulk-return-pool-qr';
	import {
		readLastBulkReturnPool,
		writeLastBulkReturnPool
	} from '../model/last-bulk-return-pool-storage';

	/** Mounted by AddBulkReturnEntriesDialog only while open, so every open starts clean. */
	interface Props {
		open: boolean;
		shelterCode?: string;
		initialPoolId?: string;
		initialReturner?: FrontlineRecipientSelection | null;
		initialItemId?: string;
		onsuccess?: (summary: AddEntriesSummary) => void;
	}

	let {
		open = $bindable(),
		shelterCode,
		initialPoolId,
		initialReturner = null,
		initialItemId,
		onsuccess
	}: Props = $props();

	const POOL_SCAN_FORMATS = [Html5QrcodeSupportedFormats.QR_CODE];

	const addMutation = useAddBulkReturnEntries();
	const overviewQuery = useBulkReturnPoolOverview(
		() => ({ includeCancelled: true }),
		() => shelterCode
	);
	const itemMastersQuery = useItemMasters(() => shelterCode ?? null);

	// Fail closed: any problem resolving the session context blocks writing.
	const canWrite = $derived.by(() => {
		try {
			return canWriteBulkReturnEntry(resolveAuthenticatedAuthorContext(shelterCode));
		} catch {
			return false;
		}
	});

	// Initial values are read once on mount (the parent remounts this form for every open).
	let pickedPoolId = $state(untrack(() => initialPoolId ?? ''));
	// Last-used pool on this device for this shelter; only a default, never overrides a pick.
	const rememberedPoolId = untrack(() =>
		shelterCode ? readLastBulkReturnPool(shelterCode) : null
	);
	let returnerSelection = $state<FrontlineRecipientSelection | null>(
		untrack(() => (initialReturner?.recipientType === 'outside' ? null : initialReturner))
	);
	let unspecified = $state(false);
	let lines = $state<AddEntryLine[]>(
		untrack(() => addLine([], createStableOperationId, { item_id: initialItemId }))
	);
	let notes = $state('');
	let showErrors = $state(false);
	let submitError = $state<string | null>(null);

	const openPools = $derived(listOpenPools(overviewQuery.data ?? []));
	// Picked pool, else remembered last-used pool, else the only OPEN pool; '' when none is OPEN.
	// A scanned pool QR wins over the Select pick until the user picks again.
	let poolScannerOpen = $state(false);
	let scannedPoolId = $state<string | null>(null);
	let poolScanInvalid = $state(false);
	const effectivePicked = $derived(scannedPoolId ?? pickedPoolId);
	const poolId = $derived(
		resolveDefaultPoolId({ picked: effectivePicked, remembered: rememberedPoolId, openPools })
	);
	const poolScanStatus = $derived.by<'checking' | 'not_found' | 'invalid' | null>(() => {
		if (poolScanInvalid) return 'invalid';
		if (scannedPoolId === null) return null;
		if (overviewQuery.isPending) return 'checking';
		return openPools.some((pool) => pool._id === scannedPoolId) ? null : 'not_found';
	});
	const poolScanProcessing = $derived(poolScanStatus === 'checking');
	const poolScanError = $derived(
		poolScanStatus === 'invalid'
			? 'QR นี้ไม่ใช่ QR ของกองรับคืน'
			: poolScanStatus === 'not_found'
				? 'ไม่พบกองนี้ หรือกองไม่ได้เปิดรับแล้ว'
				: null
	);
	const selectedPool = $derived(openPools.find((pool) => pool._id === poolId) ?? null);

	const catalog = $derived(
		filterEligibleItems(
			(itemMastersQuery.data ?? []).map((item) => ({
				_id: item._id,
				name: item.name,
				base_unit: item.base_unit,
				returnable: item.returnable,
				deactivated: item.deactivated,
				merged_into: item.merged_into
			}))
		)
	);

	const choice = $derived<ReturnerChoice>(unspecified ? 'unspecified' : returnerSelection);
	const returnerResolution = $derived(resolveReturner(choice));
	const returnerId = $derived(identifiedReturnerId(choice));
	const loansQuery = useReturnerOutstandingLoans(
		() => returnerId,
		() => shelterCode
	);
	const loanRows = $derived(outstandingLoanRows(loansQuery.data ?? [], catalog));
	const showNoLoanWarning = $derived(
		hasNoOutstandingLoanWarning(
			returnerResolution.returner ?? null,
			loansQuery.data ?? [],
			loansQuery.isPending || loansQuery.isError
		)
	);

	const validation = $derived(validateAddEntryLines(lines));

	function itemLabel(itemId: string): string {
		if (!itemId) return 'เลือกสินค้า';
		const item = resolveItemDisplay(itemId, catalog);
		return item.unit ? `${item.name} (${item.unit})` : item.name;
	}

	function handlePoolScan(code: string) {
		const parsed = parsePoolScanCode(code);
		poolScanInvalid = parsed === null;
		scannedPoolId = parsed;
	}

	function handlePoolSelect(value: string) {
		pickedPoolId = value;
		scannedPoolId = null;
		poolScanInvalid = false;
	}

	// "คืนทั้งหมด": replaces the lines with one line per outstanding item (qty stays editable).
	let returnAllSkippedNote = $state<string | null>(null);

	function handleReturnAll() {
		const result = linesFromOutstandingLoans(
			loanRows,
			new Set(catalog.map((item) => item._id)),
			(preset) => addLine([], createStableOperationId, preset)[0]
		);
		if (result.lines.length > 0) lines = result.lines;
		returnAllSkippedNote =
			result.skippedItemIds.length > 0
				? `ข้าม ${result.skippedItemIds.length} รายการที่เลือกในแคตตาล็อกไม่ได้: ${result.skippedItemIds
						.map((id) => resolveItemDisplay(id, catalog).name)
						.join(', ')}`
				: null;
	}

	function handleOpenChange(next: boolean) {
		if (!next && !addMutation.isPending) open = false;
	}

	function reportSummary(summary: AddEntriesSummary) {
		const total = summary.savedCount + summary.replayedCount;
		if (total > 0) {
			toast.success(
				`บันทึกเข้ากองแล้ว ${total} รายการ${summary.loanAppliedQty ? ` · ตัดยอดยืม ${summary.loanAppliedQty}` : ''}`
			);
		}
		if (summary.noOutstandingLoan) toast.warning(NO_OUTSTANDING_LOAN_WARNING);
		if (summary.lateEntries.length > 0) toast.warning(LATE_RESULT_WARNING);
		if (summary.unallocated.length > 0) {
			const detail = summary.unallocated
				.map((u) => `${resolveItemDisplay(u.item_id, catalog).name} ${u.qty}`)
				.join(', ');
			toast.info(`ส่วนที่ไม่ตรงกับรายการยืม (เข้ากองโดยไม่ตัดยอด): ${detail}`);
		}
	}

	async function handleSubmit() {
		submitError = null;
		showErrors = true;
		if (!canWrite) {
			submitError = 'คุณไม่มีสิทธิ์บันทึกของเข้ากองรับคืน';
			return;
		}
		if (!selectedPool) {
			submitError = 'กรุณาเลือกกองที่เปิดรับ';
			return;
		}
		if (!returnerResolution.returner) {
			submitError = returnerResolution.error ?? 'กรุณาระบุผู้คืน';
			return;
		}
		if (!validation.isValid) {
			submitError = validation.formError ?? 'กรุณาตรวจสอบรายการสินค้าอีกครั้ง';
			return;
		}
		const input = buildAddEntriesInput({
			poolId: selectedPool._id,
			returner: returnerResolution.returner,
			lines,
			notes
		});
		if (!input) {
			submitError = 'กรุณาตรวจสอบรายการสินค้าอีกครั้ง';
			return;
		}
		try {
			const result = await addMutation.mutateAsync({ input, shelterCode });
			const summary = summarizeAddResult(result);
			if (shelterCode && summary.savedCount + summary.replayedCount > 0) {
				writeLastBulkReturnPool(shelterCode, selectedPool._id);
			}
			reportSummary(summary);
			// A late entry stops the workflow: the lines that were not written stay for a retry.
			lines = dropWrittenLines(lines, result);
			if (lines.length === 0) {
				open = false;
				onsuccess?.(summary);
			} else {
				submitError =
					'บางรายการยังไม่ได้บันทึก เพราะกองนี้ไม่รับของแล้ว กรุณาเลือกกองอื่นที่เปิดรับ แล้วกดบันทึกอีกครั้ง';
			}
		} catch (err) {
			// Line operationUlids are kept, so pressing save again is an idempotent retry.
			const message = formatDistributionError(
				err,
				'บันทึกของเข้ากองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
			);
			submitError = message;
			toast.error(message);
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-[640px]">
		<div class="border-b border-slate-100 bg-slate-50 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2.5 text-lg font-bold text-slate-900">
					<span
						class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-2xs"
					>
						<PackagePlus class="h-5 w-5" aria-hidden="true" />
					</span>
					<span>รับของเข้ากอง</span>
				</Dialog.Title>
				<Dialog.Description class="mt-1 text-sm text-slate-600">
					บันทึกของที่รับคืนเข้ากองรับคืน ระบบจะตัดยอดยืมของผู้คืนให้อัตโนมัติ (เก่าสุดก่อน)
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

				<!-- Pool -->
				<div class="space-y-1.5">
					<Label for="add-entry-pool" class="text-sm font-semibold text-slate-700">
						กองรับคืน <span class="text-red-600">*</span>
					</Label>
					{#if overviewQuery.isPending}
						<p class="text-sm text-slate-500" role="status">กำลังโหลดรายการกอง...</p>
					{:else if openPools.length === 0}
						<p
							class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900"
						>
							<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
							<span>ยังไม่มีกองที่เปิดรับอยู่ กรุณาให้หัวหน้าเปิดกองใหม่ก่อน</span>
						</p>
					{:else}
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
							<Select.Root type="single" bind:value={() => poolId, handlePoolSelect}>
								<Select.Trigger
									id="add-entry-pool"
									class="h-11 w-full min-w-0 bg-white text-sm font-medium sm:h-10 sm:flex-1"
								>
									<span class="truncate">
										{selectedPool ? selectedPool.name : 'เลือกกองที่เปิดรับ'}
									</span>
								</Select.Trigger>
								<Select.Content>
									{#each openPools as pool (pool._id)}
										<Select.Item value={pool._id} label={pool.name} />
									{/each}
								</Select.Content>
							</Select.Root>
							<Button
								type="button"
								variant="outline"
								disabled={poolScanProcessing || addMutation.isPending}
								onclick={() => (poolScannerOpen = true)}
								class="min-h-11 w-full gap-2 sm:w-auto"
							>
								{#if poolScanProcessing}
									<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
									กำลังตรวจสอบ QR...
								{:else}
									<QrCode class="h-4 w-4" aria-hidden="true" />
									สแกน QR กอง
								{/if}
							</Button>
						</div>
						{#if poolScanProcessing}
							<p class="text-sm text-slate-500" role="status">กำลังตรวจสอบ QR กอง...</p>
						{/if}
						{#if poolScanError}
							<p role="alert" class="text-xs font-medium text-red-700">{poolScanError}</p>
						{/if}
					{/if}
				</div>

				<!-- Returner -->
				<div class="space-y-3">
					<p class="text-sm font-semibold text-slate-700">
						ผู้คืน <span class="text-red-600">*</span>
					</p>
					<div class="flex min-h-11 items-center gap-2">
						<Switch id="add-entry-unspecified" bind:checked={unspecified} />
						<Label for="add-entry-unspecified" class="text-sm font-medium text-slate-700">
							ไม่ระบุผู้คืน
						</Label>
					</div>
					<RecipientSearchPicker
						bind:value={returnerSelection}
						allowOutside={false}
						disabled={unspecified}
					/>
					{#if showErrors && !returnerResolution.returner && returnerResolution.error}
						<p role="alert" class="text-xs font-medium text-red-700">{returnerResolution.error}</p>
					{/if}

					{#if returnerId}
						{#if loansQuery.isPending}
							<p class="flex items-center gap-2 text-sm text-slate-500" role="status">
								<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
								กำลังโหลดรายการยืมค้าง...
							</p>
						{:else if loansQuery.isError}
							<p role="alert" class="text-sm text-red-700">
								{formatDistributionError(loansQuery.error, 'โหลดรายการยืมค้างไม่สำเร็จ')}
							</p>
						{:else if showNoLoanWarning}
							<div
								role="status"
								class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm font-semibold text-amber-900"
							>
								<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
								<p>{NO_OUTSTANDING_LOAN_WARNING}</p>
							</div>
						{:else if loanRows.length > 0}
							<div class="space-y-1.5 rounded-xl border border-slate-200/80 bg-white p-3">
								<p class="text-sm font-semibold text-slate-700">
									รายการยืมค้างของผู้คืน
									<span class="font-normal text-slate-500 tabular-nums">({loanRows.length})</span>
								</p>
								<ul class="divide-y divide-slate-100 text-sm">
									{#each loanRows as loan (loan.logId)}
										<li class="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
											<span class="font-medium break-words text-slate-900">{loan.itemName}</span>
											<span class="text-slate-600 tabular-nums">
												ค้าง <span class="font-semibold text-slate-900">{loan.outstanding}</span>
												{loan.unit} · ยืมเมื่อ {formatThaiShortDate(loan.distributed_at)}
											</span>
										</li>
									{/each}
								</ul>
								<div class="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:gap-3">
									<Button
										type="button"
										variant="outline"
										disabled={addMutation.isPending}
										onclick={handleReturnAll}
										class="min-h-11 w-full gap-2 sm:w-auto"
									>
										<ListChecks class="h-4 w-4" aria-hidden="true" />
										คืนทั้งหมด
									</Button>
									{#if returnAllSkippedNote}
										<p role="status" class="text-xs font-medium text-amber-800">
											{returnAllSkippedNote}
										</p>
									{/if}
								</div>
							</div>
						{/if}
					{/if}
				</div>

				<!-- Item lines -->
				<div class="space-y-3">
					<p class="text-sm font-semibold text-slate-700">
						รายการสินค้าที่รับคืน <span class="text-red-600">*</span>
					</p>
					{#if itemMastersQuery.isSuccess && catalog.length === 0}
						<p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
							ไม่พบสินค้าประเภทยืม-คืนในแคตตาล็อกของศูนย์นี้
						</p>
					{/if}
					<ul class="space-y-3">
						{#each lines as line, index (line.lineId)}
							{@const lineError = showErrors ? validation.lineErrors[line.lineId] : undefined}
							<li class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
								<div
									class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end"
								>
									<div class="min-w-0 space-y-1.5">
										<Label
											for="add-entry-item-{line.lineId}"
											class="text-sm font-semibold text-slate-700"
										>
											สินค้า
										</Label>
										<Select.Root type="single" bind:value={line.item_id}>
											<Select.Trigger
												id="add-entry-item-{line.lineId}"
												aria-invalid={Boolean(lineError)}
												class="h-11 w-full min-w-0 bg-white text-sm font-medium sm:h-10"
											>
												<span class="truncate">{itemLabel(line.item_id)}</span>
											</Select.Trigger>
											<Select.Content>
												{#each catalog as item (item._id)}
													<Select.Item value={item._id} label={item.name} />
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
									<div class="space-y-1.5">
										<Label
											for="add-entry-qty-{line.lineId}"
											class="text-sm font-semibold text-slate-700"
										>
											จำนวน
										</Label>
										<Input
											id="add-entry-qty-{line.lineId}"
											type="text"
											inputmode="numeric"
											autocomplete="off"
											bind:value={line.qty}
											aria-invalid={Boolean(lineError)}
											placeholder="0"
											class="h-11 text-base tabular-nums sm:h-10 sm:text-sm"
										/>
									</div>
									<Button
										type="button"
										variant="outline"
										disabled={lines.length === 1 || addMutation.isPending}
										onclick={() => (lines = removeLine(lines, line.lineId))}
										class="min-h-11 w-full gap-2 sm:w-auto"
									>
										<Trash2 class="h-4 w-4" aria-hidden="true" />
										<span class="sm:sr-only">ลบรายการที่ {index + 1}</span>
									</Button>
								</div>
								{#if lineError}
									<p role="alert" class="text-xs font-medium text-red-700">{lineError}</p>
								{/if}
							</li>
						{/each}
					</ul>
					<Button
						type="button"
						variant="outline"
						disabled={addMutation.isPending}
						onclick={() => (lines = addLine(lines, createStableOperationId))}
						class="min-h-11 w-full gap-2 sm:w-auto"
					>
						<Plus class="h-4 w-4" aria-hidden="true" />
						เพิ่มรายการสินค้า
					</Button>
				</div>

				<div class="space-y-1.5">
					<Label for="add-entry-notes" class="text-sm font-semibold text-slate-700">
						หมายเหตุ (ไม่บังคับ)
					</Label>
					<Textarea
						id="add-entry-notes"
						bind:value={notes}
						rows={2}
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
					onclick={() => (open = false)}
					disabled={addMutation.isPending}
					class="min-h-11 w-full sm:w-auto"
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					disabled={addMutation.isPending || !canWrite || openPools.length === 0}
					class="min-h-11 w-full gap-2 sm:w-auto"
				>
					{#if addMutation.isPending}
						<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
						<span>กำลังบันทึก...</span>
					{:else}
						<PackagePlus class="h-4 w-4" aria-hidden="true" />
						<span>บันทึกเข้ากอง</span>
					{/if}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<CameraCodeScannerDialog
	bind:open={poolScannerOpen}
	title="สแกน QR กอง"
	hint="เล็งกล้องไปที่ QR บนป้ายกองรับคืน หรือพิมพ์ / ยิงรหัสด้วยเครื่องสแกน"
	formats={POOL_SCAN_FORMATS}
	manualInputMode="text"
	onScan={handlePoolScan}
/>
