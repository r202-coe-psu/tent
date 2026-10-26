<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useTransfers,
		useDispatchTransfer,
		useReceiveTransfer,
		useCancelTransfer,
		useDisputeTransfer,
		useResumeTransfer
	} from '../application/queries';
	import { isTransferPending } from '../domain/transfer-pending';
	import { transferItemLabel, transferItemNames } from '../domain/transfer-item-label';
	import { formatUnit, useItemMasters, useUnitsOfMeasure } from '$lib/features/catalog';
	import { useSupplyItems } from '$lib/features/supply';
	import { langState } from '$lib/states/i18n.svelte';
	import { toast } from 'svelte-sonner';
	import {
		cancelInfoSchema,
		disputeInfoSchema,
		TransferForbiddenError,
		type StockTransfer,
		type DispatchInfoInput
	} from '../domain/operations';
	import DispatchConfirmDialog from './dispatch-confirm-dialog.svelte';
	import TransferDetailSheet from './transfer-detail-sheet.svelte';
	import { STATUS_LABEL, statusBadgeClass } from './transfer-status';
	import Truck from '@lucide/svelte/icons/truck';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Ban from '@lucide/svelte/icons/ban';
	import CirclePause from '@lucide/svelte/icons/circle-pause';
	import CirclePlay from '@lucide/svelte/icons/circle-play';
	import PackageMinus from '@lucide/svelte/icons/package-minus';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import Eye from '@lucide/svelte/icons/eye';

	const transfersQuery = useTransfers();
	const dispatchMutation = useDispatchTransfer();
	const receiveMutation = useReceiveTransfer();
	const cancelMutation = useCancelTransfer();
	const disputeMutation = useDisputeTransfer();
	const resumeMutation = useResumeTransfer();

	const ownShelter = getShelterCode();

	// Unfiltered catalog (not `useStockFormItems`): history must name deactivated/merged items too.
	const supplyItemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const namesById = $derived(
		transferItemNames(supplyItemsQuery.data ?? [], itemMastersQuery.data ?? [])
	);
	const units = $derived(unitsQuery.data ?? []);

	function unitLabel(unit: string): string {
		return formatUnit(unit, units, langState.current);
	}

	function itemLine(item: StockTransfer['items'][number]): string {
		return transferItemLabel(item, namesById, unitLabel).text;
	}

	// Session expired (`needsReauth`): every action button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);

	/** CR-089 FR-03/FR-04 — cancel and dispute both need a reason, so they share one prompt. */
	type ReasonMode = 'cancel' | 'dispute';

	let dispatchTarget = $state<StockTransfer | null>(null);
	let dispatchOpen = $state(false);

	let reasonTarget = $state<StockTransfer | null>(null);
	let reasonMode = $state<ReasonMode>('cancel');
	let reasonOpen = $state(false);
	let reasonText = $state('');

	const dispatchRoute = $derived(
		dispatchTarget ? `${dispatchTarget.from_shelter} → ${dispatchTarget.to_shelter}` : ''
	);

	const reasonCopy = $derived(
		reasonMode === 'dispute'
			? {
					title: 'คัดค้าน / ระงับคำร้อง',
					description: 'ระงับคำร้องนี้ไว้ชั่วคราวพร้อมระบุเหตุผล — ยังกลับมาดำเนินการต่อได้ภายหลัง',
					label: 'เหตุผลที่คัดค้าน/ระงับ',
					placeholder: 'เช่น สต็อกต้นทางไม่พอตามที่ขอ',
					confirmLabel: 'ยืนยันการระงับ',
					pendingLabel: 'กำลังระงับ...'
				}
			: {
					title: 'ยกเลิกคำร้องโอนย้าย',
					description: 'ยกเลิกคำร้องนี้อย่างถาวรพร้อมระบุเหตุผล — ไม่สามารถย้อนกลับได้',
					label: 'เหตุผลที่ยกเลิก',
					placeholder: 'เช่น ปลายทางแจ้งว่าไม่ต้องการแล้ว',
					confirmLabel: 'ยืนยันการยกเลิก',
					pendingLabel: 'กำลังยกเลิก...'
				}
	);

	const reasonPending = $derived(
		reasonMode === 'dispute' ? disputeMutation.isPending : cancelMutation.isPending
	);

	const outgoingBusy = $derived(
		dispatchMutation.isPending ||
			cancelMutation.isPending ||
			disputeMutation.isPending ||
			resumeMutation.isPending
	);

	const transfers = $derived(transfersQuery.data ?? []);
	/** A refused or failed list is not an empty one — say which (#571). */
	const listForbidden = $derived(transfersQuery.error instanceof TransferForbiddenError);
	// A background refetch that fails keeps the list it already has, so only a refusal or a list
	// that never loaded replaces the cards with the alert.
	const listUnavailable = $derived(
		transfersQuery.isError && (listForbidden || transfersQuery.data === undefined)
	);

	let detailId = $state<string | null>(null);
	let detailOpen = $state(false);
	const detailTransfer = $derived(transfers.find((t) => t._id === detailId) ?? null);

	function openDetail(t: StockTransfer) {
		detailId = t._id;
		detailOpen = true;
	}

	const incomingPending = $derived(
		transfers.filter((t) => t.to_shelter === ownShelter && t.status === 'shipped')
	);
	const outgoingPending = $derived(
		transfers.filter(
			(t) => t.from_shelter === ownShelter && (t.status === 'requested' || t.status === 'disputed')
		)
	);

	function isOutgoing(t: StockTransfer): boolean {
		return t.from_shelter === ownShelter;
	}

	function errorMessage(err: unknown): string {
		return err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
	}

	function openDispatch(t: StockTransfer) {
		dispatchTarget = t;
		dispatchOpen = true;
	}

	function openReason(t: StockTransfer, mode: ReasonMode) {
		reasonTarget = t;
		reasonMode = mode;
		reasonText = '';
		reasonOpen = true;
	}

	function handleReasonOpenChange(next: boolean) {
		reasonOpen = next;
		if (!next) reasonText = '';
	}

	async function handleDispatchConfirm(info: DispatchInfoInput) {
		const target = dispatchTarget;
		if (!target) return;

		const pending = dispatchMutation.mutateAsync({ id: target._id, info });
		toast.promise(pending, {
			loading: 'กำลังอนุมัติส่งมอบ...',
			success: 'อนุมัติส่งมอบสำเร็จ',
			error: errorMessage
		});
		try {
			await pending;
			dispatchOpen = false;
		} catch {
			// The toast already reported it; keep the dialog open so the typed values survive.
		}
	}

	async function handleReasonConfirm() {
		const target = reasonTarget;
		if (!target) return;

		// Validate with the same schema the server parses, so client and domain cannot disagree.
		let pending: Promise<StockTransfer>;
		if (reasonMode === 'dispute') {
			const parsed = disputeInfoSchema.safeParse({ dispute_reason: reasonText });
			if (!parsed.success) {
				toast.error(parsed.error.issues[0]?.message ?? 'กรุณาระบุเหตุผล');
				return;
			}
			pending = disputeMutation.mutateAsync({ id: target._id, info: parsed.data });
		} else {
			const parsed = cancelInfoSchema.safeParse({ cancel_reason: reasonText });
			if (!parsed.success) {
				toast.error(parsed.error.issues[0]?.message ?? 'กรุณาระบุเหตุผล');
				return;
			}
			pending = cancelMutation.mutateAsync({ id: target._id, info: parsed.data });
		}

		toast.promise(pending, {
			loading: reasonCopy.pendingLabel,
			success: reasonMode === 'dispute' ? 'ระงับคำร้องแล้ว' : 'ยกเลิกคำร้องสำเร็จ',
			error: errorMessage
		});
		try {
			await pending;
			reasonOpen = false;
			reasonText = '';
		} catch {
			// Keep the dialog open so the typed reason is not lost.
		}
	}

	function handleReceive(t: StockTransfer) {
		// Interim UI: full receipt by default. Partial receipt (loss/damage + reason) needs
		// per-item qty editing, out of scope for this minimal round — see CR-059 field notes.
		const receivedItems = t.items.map((i) => ({ item_id: i.item_id, qty: i.qty }));
		toast.promise(receiveMutation.mutateAsync({ id: t._id, receivedItems }), {
			loading: 'กำลังยืนยันรับเข้า...',
			success: 'ยืนยันรับเข้าสำเร็จ',
			error: errorMessage
		});
	}

	/** CR-089 FR-05 — resume needs no extra field, so it fires straight from the row. */
	function handleResume(t: StockTransfer) {
		toast.promise(resumeMutation.mutateAsync(t._id), {
			loading: 'กำลังกลับมาดำเนินการต่อ...',
			success: 'กลับมาดำเนินการต่อแล้ว',
			error: errorMessage
		});
	}

	function itemsSummary(t: StockTransfer): string {
		return t.items.map(itemLine).join(', ');
	}
</script>

<div class="@container flex flex-col gap-4">
	{#if listUnavailable}
		<!-- Without this the three cards read "nothing to receive / send / no transfers". -->
		<div
			role="alert"
			class="flex items-start gap-3 rounded-2xl border p-5 shadow-md {listForbidden
				? 'border-amber-200 bg-amber-50'
				: 'border-border/80 bg-card'}"
		>
			{#if listForbidden}
				<ShieldAlert class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
				<div class="space-y-1">
					<p class="text-sm font-bold text-foreground">
						บัญชีนี้ไม่มีสิทธิ์ดูรายการโอนย้ายของศูนย์นี้
					</p>
					<p class="text-sm text-muted-foreground">
						ติดต่อผู้จัดการศูนย์หากต้องการสิทธิ์เจ้าหน้าที่คลังหรือผู้ประสานงานพัสดุ
					</p>
				</div>
			{:else}
				<TriangleAlert class="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
				<div class="space-y-2">
					<p class="text-sm font-bold text-foreground">โหลดรายการโอนย้ายไม่สำเร็จ</p>
					<Button
						variant="outline"
						size="sm"
						class="min-h-11"
						disabled={transfersQuery.isFetching}
						onclick={() => transfersQuery.refetch()}
					>
						{transfersQuery.isFetching ? 'กำลังโหลด…' : 'ลองใหม่'}
					</Button>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Inbox cards -->
		<div class="grid grid-cols-1 items-start gap-4 @xl:grid-cols-2">
			<section class="rounded-2xl border border-border/80 bg-card p-4 shadow-md sm:p-5">
				<div class="mb-3 flex items-center gap-2 border-b border-border/60 pb-3">
					<PackagePlus class="h-4.5 w-4.5 text-primary" aria-hidden="true" />
					<h3 class="text-sm font-bold text-foreground">ต้องรับเข้า</h3>
					{#if incomingPending.length > 0}
						<span
							class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0284C7] px-1.5 text-[11px] font-bold text-white"
						>
							{incomingPending.length}
						</span>
					{/if}
				</div>
				{#if transfersQuery.isLoading}
					<p class="text-sm text-muted-foreground">กำลังโหลด…</p>
				{:else if incomingPending.length === 0}
					<p class="text-sm text-muted-foreground">ไม่มีรายการรอตรวจรับ</p>
				{:else}
					<ul class="space-y-3">
						{#each incomingPending as t (t._id)}
							<li
								class="flex flex-col gap-3 rounded-xl border border-sky-200/80 bg-sky-50/40 p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div class="min-w-0 space-y-1">
									<p class="font-mono text-xs font-semibold">
										{t.from_shelter} → {t.to_shelter}
									</p>
									<p class="truncate text-xs text-muted-foreground">{itemsSummary(t)}</p>
								</div>
								<button
									type="button"
									onclick={() => handleReceive(t)}
									disabled={receiveMutation.isPending || offline}
									class={buttonVariants({ size: 'sm' })}
								>
									<PackageCheck class="mr-1 h-3.5 w-3.5" />ตรวจรับ
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="rounded-2xl border border-border/80 bg-card p-4 shadow-md sm:p-5">
				<div class="mb-3 flex items-center gap-2 border-b border-border/60 pb-3">
					<PackageMinus class="h-4.5 w-4.5 text-primary" aria-hidden="true" />
					<h3 class="text-sm font-bold text-foreground">ต้องส่งออก</h3>
					{#if outgoingPending.length > 0}
						<span
							class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0284C7] px-1.5 text-[11px] font-bold text-white"
						>
							{outgoingPending.length}
						</span>
					{/if}
				</div>
				{#if transfersQuery.isLoading}
					<p class="text-sm text-muted-foreground">กำลังโหลด…</p>
				{:else if outgoingPending.length === 0}
					<p class="text-sm text-muted-foreground">ไม่มีรายการรอส่งมอบ</p>
				{:else}
					<ul class="space-y-3">
						{#each outgoingPending as t (t._id)}
							<li
								class="@container/card flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/80 bg-amber-50/40 p-3"
							>
								<div class="min-w-0 space-y-1">
									<p class="font-mono text-xs font-semibold">
										{t.from_shelter} → {t.to_shelter}
									</p>
									<p class="truncate text-xs text-muted-foreground">{itemsSummary(t)}</p>
									<span
										class="inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-bold {statusBadgeClass(
											t.status
										)}"
									>
										{STATUS_LABEL[t.status]}
									</span>
								</div>
								<!-- Narrow card: primary action full width, secondary ones split below.
							     Wide card: all actions inline on the right. -->
								<div
									class="grid w-full grid-cols-2 gap-2 @md/card:ml-auto @md/card:flex @md/card:w-auto @md/card:justify-end"
								>
									{#if t.status === 'requested'}
										<button
											type="button"
											onclick={() => openDispatch(t)}
											disabled={outgoingBusy || offline}
											class={buttonVariants({ size: 'sm', class: 'col-span-2' })}
										>
											<Truck class="mr-1 h-3.5 w-3.5" />ยืนยันส่ง
										</button>
										<button
											type="button"
											onclick={() => openReason(t, 'dispute')}
											disabled={outgoingBusy || offline}
											class={buttonVariants({ size: 'sm', variant: 'outline' })}
										>
											<CirclePause class="mr-1 h-3.5 w-3.5" />ระงับ
										</button>
										<button
											type="button"
											onclick={() => openReason(t, 'cancel')}
											disabled={outgoingBusy || offline}
											class={buttonVariants({ size: 'sm', variant: 'destructive' })}
										>
											<Ban class="mr-1 h-3.5 w-3.5" />ยกเลิก
										</button>
									{:else if t.status === 'disputed'}
										<button
											type="button"
											onclick={() => handleResume(t)}
											disabled={outgoingBusy || offline}
											class={buttonVariants({ size: 'sm', class: 'col-span-2' })}
										>
											<CirclePlay class="mr-1 h-3.5 w-3.5" />กลับมาดำเนินการต่อ
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<!-- History -->
		<div class="rounded-2xl border border-border/80 bg-card p-5 shadow-md">
			<div class="mb-4 flex items-center gap-2 border-b border-border/60 pb-3">
				<Truck class="h-4.5 w-4.5 text-primary" aria-hidden="true" />
				<h3 class="text-sm font-bold text-foreground">ประวัติการโอน</h3>
			</div>

			{#if transfersQuery.isLoading}
				<p class="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</p>
			{:else if transfers.length === 0}
				<p class="text-sm text-muted-foreground">ยังไม่มีรายการโอนย้าย</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>เส้นทาง</Table.Head>
							<Table.Head>รายการ</Table.Head>
							<Table.Head>สถานะ</Table.Head>
							<Table.Head><span class="sr-only">รายละเอียด</span></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each transfers as t (t._id)}
							<Table.Row
								class="cursor-pointer hover:bg-muted/50 {isTransferPending(t, ownShelter)
									? 'bg-muted/30'
									: ''}"
								onclick={() => openDetail(t)}
							>
								<Table.Cell>
									<span class="font-mono text-xs font-semibold">
										{t.from_shelter} → {t.to_shelter}
									</span>
									<span
										class="mt-1 block w-fit rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground"
									>
										{isOutgoing(t) ? 'ต้นทาง (เรา)' : 'ปลายทาง (เรา)'}
									</span>
								</Table.Cell>
								<Table.Cell class="text-xs">
									{#each t.items as item (item.item_id)}
										<div>{itemLine(item)}</div>
									{/each}
								</Table.Cell>
								<Table.Cell>
									<span
										class="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold {statusBadgeClass(
											t.status
										)}"
									>
										{STATUS_LABEL[t.status]}
									</span>
									{#if t.status === 'disputed' && t.dispute_reason}
										<div class="mt-0.5 text-[11px] font-normal text-muted-foreground">
											{t.dispute_reason}
										</div>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right">
									<button
										type="button"
										aria-label="ดูรายละเอียดการโอน {t.from_shelter} → {t.to_shelter}"
										onclick={(e) => {
											e.stopPropagation();
											openDetail(t);
										}}
										class={buttonVariants({ size: 'sm', variant: 'outline' })}
									>
										<Eye class="mr-1 h-3.5 w-3.5" />รายละเอียด
									</button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</div>
	{/if}
</div>

<DispatchConfirmDialog
	bind:open={dispatchOpen}
	route={dispatchRoute}
	isPending={dispatchMutation.isPending}
	onConfirm={handleDispatchConfirm}
/>

<TransferDetailSheet
	bind:open={detailOpen}
	transfer={detailTransfer}
	{ownShelter}
	{namesById}
	formatUnitLabel={unitLabel}
/>

<Dialog.Root bind:open={reasonOpen} onOpenChange={handleReasonOpenChange}>
	<Dialog.Content class="sm:max-w-[460px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold">{reasonCopy.title}</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				{reasonCopy.description}
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-2 py-2">
			<Label for="transfer-reason" class="text-sm font-semibold">
				{reasonCopy.label} <span class="text-destructive">*</span>
			</Label>
			<Textarea
				id="transfer-reason"
				bind:value={reasonText}
				placeholder={reasonCopy.placeholder}
				rows={3}
				disabled={reasonPending}
			/>
		</div>

		<Dialog.Footer class="gap-2">
			<Button
				variant="outline"
				onclick={() => handleReasonOpenChange(false)}
				disabled={reasonPending}
			>
				ปิด
			</Button>
			<Button
				variant="destructive"
				onclick={handleReasonConfirm}
				disabled={reasonPending || offline}
			>
				{reasonPending ? reasonCopy.pendingLabel : reasonCopy.confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
