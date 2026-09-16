<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useTransfers,
		useDispatchTransfer,
		useReceiveTransfer,
		useCancelTransfer,
		useDisputeTransfer,
		useResumeTransfer
	} from '../application/queries';
	import { toast } from 'svelte-sonner';
	import {
		cancelInfoSchema,
		disputeInfoSchema,
		type StockTransfer,
		type TransferStatus,
		type DispatchInfoInput
	} from '../domain/operations';
	import DispatchConfirmDialog from './dispatch-confirm-dialog.svelte';
	import Truck from '@lucide/svelte/icons/truck';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Ban from '@lucide/svelte/icons/ban';
	import CirclePause from '@lucide/svelte/icons/circle-pause';
	import CirclePlay from '@lucide/svelte/icons/circle-play';

	const transfersQuery = useTransfers();
	const dispatchMutation = useDispatchTransfer();
	const receiveMutation = useReceiveTransfer();
	const cancelMutation = useCancelTransfer();
	const disputeMutation = useDisputeTransfer();
	const resumeMutation = useResumeTransfer();

	const ownShelter = getShelterCode();

	const STATUS_LABEL: Record<TransferStatus, string> = {
		requested: 'รอส่งมอบ',
		shipped: 'ระหว่างขนส่ง',
		received: 'ส่งมอบสำเร็จ',
		cancelled: 'ยกเลิกแล้ว',
		disputed: 'ระงับไว้'
	};

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
</script>

<div class="rounded-2xl border border-border/80 bg-card p-5 shadow-md">
	<div class="mb-4 flex items-center gap-2 border-b border-border/60 pb-3">
		<Truck class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">รายการโอนย้ายข้ามศูนย์</h3>
	</div>

	{#if transfersQuery.isLoading}
		<p class="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</p>
	{:else if !transfersQuery.data || transfersQuery.data.length === 0}
		<p class="text-sm text-muted-foreground">ยังไม่มีรายการโอนย้าย</p>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>เส้นทาง</Table.Head>
					<Table.Head>รายการ</Table.Head>
					<Table.Head>สถานะ</Table.Head>
					<Table.Head class="text-right">การดำเนินการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each transfersQuery.data as t (t._id)}
					<Table.Row>
						<Table.Cell>
							<span class="font-mono text-xs font-semibold">{t.from_shelter} → {t.to_shelter}</span>
							<span
								class="ml-2 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground"
							>
								{isOutgoing(t) ? 'ต้นทาง (เรา)' : 'ปลายทาง (เรา)'}
							</span>
						</Table.Cell>
						<Table.Cell class="text-xs">
							{#each t.items as item (item.item_id)}
								<div>{item.item_id} — {item.qty} {item.unit}</div>
							{/each}
						</Table.Cell>
						<Table.Cell class="text-xs font-semibold">
							{STATUS_LABEL[t.status]}
							{#if t.status === 'disputed' && t.dispute_reason}
								<div class="mt-0.5 text-[11px] font-normal text-muted-foreground">
									{t.dispute_reason}
								</div>
							{/if}
						</Table.Cell>
						<Table.Cell>
							<div class="flex flex-wrap justify-end gap-2">
								{#if isOutgoing(t) && t.status === 'requested'}
									<button
										onclick={() => openDispatch(t)}
										disabled={outgoingBusy}
										class={buttonVariants({ size: 'sm' })}
									>
										<Truck class="mr-1 h-3.5 w-3.5" />อนุมัติส่งมอบ
									</button>
									<button
										onclick={() => openReason(t, 'dispute')}
										disabled={outgoingBusy}
										class={buttonVariants({ size: 'sm', variant: 'outline' })}
									>
										<CirclePause class="mr-1 h-3.5 w-3.5" />คัดค้าน/ระงับ
									</button>
									<button
										onclick={() => openReason(t, 'cancel')}
										disabled={outgoingBusy}
										class={buttonVariants({ size: 'sm', variant: 'outline' })}
									>
										<Ban class="mr-1 h-3.5 w-3.5" />ยกเลิก
									</button>
								{:else if isOutgoing(t) && t.status === 'disputed'}
									<button
										onclick={() => handleResume(t)}
										disabled={outgoingBusy}
										class={buttonVariants({ size: 'sm' })}
									>
										<CirclePlay class="mr-1 h-3.5 w-3.5" />กลับมาดำเนินการต่อ
									</button>
								{:else if !isOutgoing(t) && t.status === 'shipped'}
									<button
										onclick={() => handleReceive(t)}
										disabled={receiveMutation.isPending}
										class={buttonVariants({ size: 'sm' })}
									>
										<PackageCheck class="mr-1 h-3.5 w-3.5" />ยืนยันรับเข้า
									</button>
								{/if}
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>

<DispatchConfirmDialog
	bind:open={dispatchOpen}
	route={dispatchRoute}
	isPending={dispatchMutation.isPending}
	onConfirm={handleDispatchConfirm}
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
			<Button variant="destructive" onclick={handleReasonConfirm} disabled={reasonPending}>
				{reasonPending ? reasonCopy.pendingLabel : reasonCopy.confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
