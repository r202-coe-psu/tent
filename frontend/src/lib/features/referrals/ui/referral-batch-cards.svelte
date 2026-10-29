<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Ban from '@lucide/svelte/icons/ban';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Archive from '@lucide/svelte/icons/archive';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Send from '@lucide/svelte/icons/send';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Clock from '@lucide/svelte/icons/clock';
	import User from '@lucide/svelte/icons/user';
	import type { Component } from 'svelte';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { SvelteSet } from 'svelte/reactivity';
	import { getShelterCode } from '$lib/db/shelter';
	import type { Referral, ReferralStatus } from '../domain/referral.schema';
	import type {
		ReferralBatchFailure,
		ReferralBulkTransitionResult
	} from '../data/referral.repository';
	import {
		REFERRAL_ACTIONS,
		REFERRAL_REASON_MAX_LENGTH,
		getCommonActions,
		getReferralActions,
		getRowSelectability,
		getSelectAllIds,
		type ReferralActionKey,
		type ReferralActionMeta
	} from '../domain/referral.bulk-actions';
	import {
		isIncomingCapacityReferral,
		isOutgoingCapacityReferral
	} from '../domain/referral.authorization';
	import { useBulkTransition } from '../application/queries';
	import ReferralConfirmDialog from './referral-confirm-dialog.svelte';
	import {
		formatReferralDate,
		getKindLabel,
		getStatusBadgeVariant,
		getStatusLabel,
		getUrgencyLabel,
		getUrgencyStyle,
		isRowActivationKey,
		resolveEvacueeName
	} from './referral.ui-helpers';

	let {
		referrals,
		failed = [],
		onBack,
		mode = 'created',
		onSelectReferral,
		selectedId = null
	}: {
		referrals: Referral[];
		failed?: ReferralBatchFailure[];
		onBack?: () => void;
		/** `created` = post-create result; `view` = open batch from list (selection + bulk actions) */
		mode?: 'created' | 'view';
		onSelectReferral?: (id: string) => void;
		selectedId?: string | null;
	} = $props();

	const queryClient = useQueryClient();
	const bulk = useBulkTransition(queryClient);
	const progress = bulk.progress;
	const actorShelter = $derived(getShelterCode());

	/** Members straight from the parent's query; transitions patch that cache, so no local copy. */
	const items = $derived(referrals);

	const sample = $derived(items[0] ?? null);

	const sharedStatus = $derived.by(() => {
		if (items.length === 0) return null;
		const first = items[0]!.status;
		return items.every((r) => r.status === first) ? first : null;
	});

	const destinationLabel = $derived.by(() => {
		if (!sample) return '—';
		if (sample.referral_type === 'capacity') {
			return sample.to_shelter_code ?? '—';
		}
		return sample.to_org?.name ?? '—';
	});

	const incomingSent = $derived(
		items.filter((r) => isIncomingCapacityReferral(r, actorShelter) && r.status === 'sent')
	);
	const awaitingDest = $derived(
		items.some((r) => isOutgoingCapacityReferral(r, actorShelter) && r.status === 'sent')
	);

	/** Display names by referral id, built once per `items` change (from each `evacuee_summary`). */
	const nameById = $derived(
		new Map(items.map((r) => [r._id, resolveEvacueeName(r.evacuee_summary)] as const))
	);

	function evacueeName(referral: Referral): string {
		return nameById.get(referral._id) ?? resolveEvacueeName(referral.evacuee_summary);
	}

	// --- Selection (batch page only): one status at a time, only rows that have an action. ---
	const selectionEnabled = $derived(mode === 'view');
	const selected = new SvelteSet<string>();

	const actionsById = $derived(
		new Map(items.map((r) => [r._id, getReferralActions(r, actorShelter)] as const))
	);
	const selectedStatus = $derived<ReferralStatus | null>(
		items.find((r) => selected.has(r._id))?.status ?? null
	);
	const selectedItems = $derived(
		items.filter((r) => selected.has(r._id) && r.status === selectedStatus)
	);
	const commonActions = $derived(getCommonActions(selectedItems, actorShelter));
	const selectAllIds = $derived(getSelectAllIds(items, selectedStatus, actorShelter));
	const allSelected = $derived(
		selectAllIds.length > 0 && selectAllIds.every((id) => selected.has(id))
	);
	const selectAllStatus = $derived(items.find((r) => r._id === selectAllIds[0])?.status ?? null);

	function toggle(id: string, checked: boolean) {
		if (checked) selected.add(id);
		else selected.delete(id);
	}

	function clearSelection() {
		selected.clear();
	}

	function toggleAll() {
		const ids = selectAllIds;
		const everySelected = allSelected;
		selected.clear();
		if (!everySelected) for (const id of ids) selected.add(id);
	}

	// --- Actions: every one (bulk or single row) confirms, then goes through the bulk hook. ---
	const confirmTitles: Record<ReferralActionKey, string> = {
		send: 'ยืนยันการส่งตัว',
		cancel_draft: 'ยืนยันการยกเลิกร่าง',
		withdraw: 'ยืนยันการถอนคำขอ',
		close: 'ยืนยันการปิดรายการ',
		accept: 'ยืนยันการตอบรับ',
		reject: 'ยืนยันการปฏิเสธ'
	};
	const confirmLabels: Record<ReferralActionKey, string> = {
		send: 'ส่งตัว',
		cancel_draft: 'ยกเลิกร่าง',
		withdraw: 'ถอนคำขอ',
		close: 'ปิดรายการ',
		accept: 'ยืนยันตอบรับ',
		reject: 'ยืนยันปฏิเสธ'
	};
	const actionIcons: Record<ReferralActionKey, Component> = {
		send: Send,
		cancel_draft: Ban,
		withdraw: Undo2,
		close: Archive,
		accept: CheckCircle2,
		reject: XCircle
	};
	const actionClasses: Record<ReferralActionKey, string> = {
		send: '',
		accept: 'bg-emerald-600 text-white hover:bg-emerald-700',
		reject: 'border-rose-300 text-rose-600 hover:bg-rose-50',
		cancel_draft: 'border-rose-300 text-rose-700 hover:bg-rose-50',
		withdraw: 'border-rose-300 text-rose-700 hover:bg-rose-50',
		close: 'border-slate-300 text-slate-700 hover:bg-slate-50'
	};

	type ConfirmRequest = { action: ReferralActionMeta; ids: string[]; names: string[] };
	let confirmOpen = $state(false);
	let confirmRequest = $state.raw<ConfirmRequest | null>(null);
	let reasonInput = $state('');
	/** Action of the run whose progress/result the bar shows (kept for the retry toast). */
	let runAction = $state.raw<ReferralActionMeta | null>(null);

	function askConfirm(action: ReferralActionMeta, list: Referral[]) {
		reasonInput = '';
		confirmRequest = { action, ids: list.map((r) => r._id), names: list.map(evacueeName) };
		confirmOpen = true;
	}

	function notify(action: ReferralActionMeta, result: ReferralBulkTransitionResult | undefined) {
		if (!result) return;
		if (result.failed.length === 0) {
			toast.success(`${action.toastLabel}สำเร็จ ${result.succeeded.length} รายการ`);
			progress.reset();
		} else {
			toast.error(
				`${action.toastLabel}สำเร็จ ${progress.succeeded} / ล้มเหลว ${progress.failed.length} จาก ${progress.total}`
			);
		}
	}

	async function execute(ids: string[], action: ReferralActionMeta, reason?: string) {
		runAction = action;
		try {
			notify(action, await bulk.run(ids, action.to, reason));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
		}
	}

	async function retryFailed() {
		const action = runAction;
		if (!action) return;
		try {
			notify(action, await bulk.retryFailed());
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
		}
	}

	/** Starts the run without awaiting it, so the dialog closes and the sticky bar shows progress. */
	function confirmRun() {
		const request = confirmRequest;
		if (!request) return;
		const reason = request.action.asksReason ? reasonInput.trim() || undefined : undefined;
		clearSelection();
		void execute(request.ids, request.action, reason);
	}

	const busy = $derived(bulk.mutation.isPending);
	const showBar = $derived(
		selectionEnabled && (selectedItems.length > 0 || progress.phase !== 'idle')
	);
</script>

{#snippet actionButton(
	action: ReferralActionMeta,
	onclick: (e: MouseEvent) => void,
	compact: boolean
)}
	{@const Icon = actionIcons[action.key]}
	<Button
		size={compact ? 'sm' : 'default'}
		variant={action.key === 'send' || action.key === 'accept' ? 'default' : 'outline'}
		class="gap-1.5 {compact ? '' : 'h-11 px-4'} {actionClasses[action.key]}"
		disabled={busy}
		{onclick}
	>
		<Icon class="h-4 w-4" />
		{action.label}
	</Button>
{/snippet}

<div class="flex flex-col pb-4">
	<div class="space-y-6">
		{#if mode === 'created'}
			<div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
				<div class="space-y-1">
					<h2 class="text-xl font-bold tracking-tight">ผลการสร้างรายการส่งต่อ</h2>
					<p class="text-sm text-muted-foreground">
						สำเร็จ {items.length} รายการ
						{#if failed.length > 0}
							· ล้มเหลว {failed.length} รายการ
						{/if}
					</p>
				</div>
				{#if onBack}
					<Button variant="outline" onclick={onBack} class="gap-2">
						<ArrowLeft class="h-4 w-4" />
						กลับไปหน้ารายการ
					</Button>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
				<div class="space-y-1">
					<h2 class="text-xl font-bold tracking-tight">รายละเอียดชุดส่งต่อ</h2>
					<p class="text-sm text-muted-foreground">
						{items.length} คนในชุดนี้{#if onSelectReferral}
							— กดแถวเพื่อเปิดรายละเอียดรายบุคคล
						{/if}
					</p>
				</div>
				{#if onBack}
					<Button variant="outline" size="sm" onclick={onBack} class="gap-2 lg:hidden">
						<ArrowLeft class="h-4 w-4" />
						กลับไปหน้ารายการ
					</Button>
				{/if}
			</div>
		{/if}

		{#if incomingSent.length > 0 && sample}
			<div
				class="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
				role="status"
			>
				คำขอย้ายเข้าจากศูนย์ <span class="font-semibold tabular-nums">{sample.shelter_code}</span>
				({incomingSent.length} คน) — ตอบรับแล้วระบบจะย้ายผู้เข้าพักเข้าศูนย์นี้ (occupancy สองฝั่งจะอัปเดตหลังตอบรับเท่านั้น)
			</div>
		{/if}

		{#if awaitingDest && sample}
			<div
				class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
				role="status"
			>
				รอศูนย์ปลายทาง
				<span class="font-semibold tabular-nums">{sample.to_shelter_code}</span>
				ตอบรับหรือปฏิเสธ — การย้ายศูนย์จะเกิดขึ้นเมื่อปลายทางกดตอบรับเท่านั้น
			</div>
		{/if}

		{#if sample}
			<Card.Root class="border border-border/80 shadow-sm">
				<Card.Header class="border-b border-border/60 bg-muted/30 pb-4">
					<Card.Title class="text-lg font-bold">ข้อมูลร่วมของชุดนี้</Card.Title>
					<Card.Description>ค่าที่แชร์ระหว่างทุกใบในชุด (ไม่ซ้ำต่อคน)</Card.Description>
				</Card.Header>
				<Card.Content class="grid gap-4 p-6 sm:grid-cols-2">
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">ประเภทส่งต่อ</p>
						<p class="text-sm font-semibold">{getKindLabel(sample.referral_type)}</p>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">ปลายทาง</p>
						<p class="text-sm font-semibold tabular-nums">{destinationLabel}</p>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">ความเร่งด่วน</p>
						<Badge class={getUrgencyStyle(sample.urgency)}>{getUrgencyLabel(sample.urgency)}</Badge>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">สถานะรวม</p>
						{#if sharedStatus}
							<span
								class="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold {getStatusBadgeVariant(
									sharedStatus
								)}"
							>
								{getStatusLabel(sharedStatus)}
							</span>
						{:else}
							<p class="text-sm font-medium">
								{#if mode === 'created' && failed.length > 0}
									สำเร็จ {items.length} / ล้มเหลว {failed.length}
								{:else}
									หลายสถานะในชุด
								{/if}
							</p>
						{/if}
					</div>
					<div class="space-y-1 sm:col-span-2">
						<p class="text-xs font-medium text-muted-foreground">เหตุผล</p>
						<p class="text-sm whitespace-pre-wrap">{sample.reason}</p>
					</div>
					{#if sample.notes}
						<div class="space-y-1 sm:col-span-2">
							<p class="text-xs font-medium text-muted-foreground">หมายเหตุ</p>
							<p class="text-sm whitespace-pre-wrap text-muted-foreground">{sample.notes}</p>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>

			{#if sample.response_reason}
				<div class="space-y-3">
					<h3
						class="text-sm font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400"
					>
						เหตุผลการตอบรับ/ปฏิเสธจากปลายทาง (Response Reason)
					</h3>
					<p
						class="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 text-sm font-medium whitespace-pre-wrap text-emerald-900 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-200"
					>
						{sample.response_reason}
					</p>
				</div>
			{/if}

			<div class="space-y-4 rounded-lg border border-border/80 p-6">
				<div class="space-y-1">
					<h3
						class="flex items-center gap-1.5 text-sm font-semibold tracking-wider text-foreground uppercase"
					>
						<Clock class="h-4 w-4 text-muted-foreground" />
						บันทึกประวัติการส่งตัว (Timeline Audit Trail)
					</h3>
					{#if sharedStatus === null}
						<p class="text-xs text-muted-foreground">
							แสดงจากใบตัวอย่างในชุด — สถานะรายคนดูในตาราง
						</p>
					{/if}
				</div>

				<div class="relative ml-3 space-y-4 border-l border-border pl-6">
					<div class="relative">
						<div
							class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary bg-background p-1"
						></div>
						<div class="text-xs">
							<span class="font-semibold">ลงบันทึกใบร่างครั้งแรก:</span>
							<span class="text-muted-foreground">{formatReferralDate(sample.created_at)}</span>
							<span
								class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
							>
								<User class="h-3 w-3" /> By: {sample.created_by}
							</span>
						</div>
					</div>

					{#if sample.timeline?.sent}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-blue-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-blue-600">ส่งข้อมูลออก (Sent):</span>
								<span class="text-muted-foreground"
									>{formatReferralDate(sample.timeline.sent.at)}</span
								>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {sample.timeline.sent.by}
								</span>
							</div>
						</div>
					{/if}

					{#if sample.timeline?.responded}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-emerald-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-emerald-600"
									>หน่วยงานปลายทางตอบสนอง (Responded):</span
								>
								<span class="text-muted-foreground"
									>{formatReferralDate(sample.timeline.responded.at)}</span
								>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {sample.timeline.responded.by}
								</span>
							</div>
						</div>
					{/if}

					{#if sample.timeline?.closed}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-slate-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-slate-600">ปิดรายการ (Closed):</span>
								<span class="text-muted-foreground"
									>{formatReferralDate(sample.timeline.closed.at)}</span
								>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {sample.timeline.closed.by}
								</span>
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if failed.length > 0}
			<div
				class="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
				role="status"
			>
				<div class="mb-2 flex items-center gap-2 font-semibold">
					<AlertTriangle class="h-4 w-4" />
					สร้างไม่สำเร็จ {failed.length} คน
				</div>
				<ul class="list-inside list-disc space-y-1 text-xs">
					{#each failed as item (item.evacuee_id)}
						<li>
							<span class="font-medium tabular-nums">{item.evacuee_id}</span>
							— {item.error}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if items.length > 0}
			{#if selectionEnabled && selectAllIds.length > 0}
				<div class="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1">
					<label class="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
						<Checkbox
							checked={allSelected}
							indeterminate={selected.size > 0 && !allSelected}
							disabled={busy}
							onCheckedChange={toggleAll}
						/>
						เลือกทั้งหมด
						<span class="font-normal text-muted-foreground tabular-nums">
							({selectAllIds.length}{selectAllStatus
								? ` · ${getStatusLabel(selectAllStatus)}`
								: ''})
						</span>
					</label>
				</div>
			{/if}
			<div class="overflow-hidden rounded-lg border border-border/80">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-muted/40 hover:bg-muted/40">
							{#if selectionEnabled}
								<Table.Head class="w-12"><span class="sr-only">เลือก</span></Table.Head>
							{/if}
							<Table.Head class="font-semibold text-foreground">ชื่อผู้เข้าพัก</Table.Head>
							<Table.Head class="font-semibold text-foreground">สถานะ</Table.Head>
							<Table.Head class="font-semibold text-foreground">สร้างเมื่อ</Table.Head>
							<Table.Head class="font-semibold text-foreground">ID</Table.Head>
							<Table.Head class="text-center font-semibold text-foreground">จัดการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each items as referral (referral._id)}
							{@const rowActions = actionsById.get(referral._id) ?? []}
							{@const selectability = getRowSelectability(referral, selectedStatus, actorShelter)}
							<Table.Row
								class="transition-colors hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none focus-visible:ring-inset
							{onSelectReferral ? 'cursor-pointer' : ''}
							{selectedId === referral._id ? 'bg-primary/5 ring-1 ring-primary/20 ring-inset' : ''}"
								tabindex={onSelectReferral ? 0 : undefined}
								aria-selected={onSelectReferral ? selectedId === referral._id : undefined}
								onclick={() => onSelectReferral?.(referral._id)}
								onkeydown={(e) => {
									if (
										isRowActivationKey({ key: e.key, isOwnTarget: e.target === e.currentTarget })
									) {
										e.preventDefault();
										onSelectReferral?.(referral._id);
									}
								}}
							>
								{#if selectionEnabled}
									<Table.Cell class="w-12">
										{#if selectability !== 'no-actions'}
											<Checkbox
												class="relative size-5 before:absolute before:-inset-3 before:content-['']"
												checked={selected.has(referral._id)}
												disabled={busy || selectability === 'other-status'}
												aria-label="เลือก {evacueeName(referral)}"
												aria-describedby={selectability === 'other-status'
													? `sel-hint-${referral._id}`
													: undefined}
												onclick={(e) => e.stopPropagation()}
												onCheckedChange={(checked) => toggle(referral._id, checked === true)}
											/>
										{/if}
									</Table.Cell>
								{/if}
								<Table.Cell class="font-semibold text-foreground">
									{evacueeName(referral)}
									{#if selectionEnabled && selectability === 'other-status'}
										<span
											id="sel-hint-{referral._id}"
											class="block text-xs font-normal text-muted-foreground"
										>
											สถานะต่างจากที่เลือก
										</span>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<span
										class="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold {getStatusBadgeVariant(
											referral.status
										)}"
									>
										{getStatusLabel(referral.status)}
									</span>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{formatReferralDate(referral.created_at)}
								</Table.Cell>
								<Table.Cell
									class="max-w-[10rem] truncate text-xs text-muted-foreground tabular-nums"
									title={referral._id}
								>
									{referral._id}
								</Table.Cell>
								<Table.Cell class="text-center">
									{#if rowActions.length > 0}
										<div class="flex flex-wrap items-center justify-center gap-1.5">
											{#each rowActions as key (key)}
												{@render actionButton(
													REFERRAL_ACTIONS[key],
													(e) => {
														e.stopPropagation();
														askConfirm(REFERRAL_ACTIONS[key], [referral]);
													},
													true
												)}
											{/each}
										</div>
									{:else}
										<span class="text-xs text-muted-foreground">—</span>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{:else if failed.length > 0}
			<p class="text-center text-sm text-muted-foreground">ไม่มีรายการที่สร้างสำเร็จในชุดนี้</p>
		{/if}
	</div>

	{#if showBar}
		<div
			class="sticky bottom-0 z-10 mt-4 border-t border-border/80 bg-background/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md supports-[backdrop-filter]:bg-background/90"
		>
			<div class="space-y-3">
				{#if progress.phase !== 'idle'}
					<div class="space-y-2 rounded-lg border border-border/80 bg-card p-3">
						<p aria-live="polite" class="text-sm font-semibold tabular-nums">
							สำเร็จ {progress.succeeded} / {progress.total}
							{#if progress.failed.length > 0}
								<span class="font-normal text-rose-700"> · ล้มเหลว {progress.failed.length}</span>
							{/if}
						</p>
						<div
							role="progressbar"
							aria-label="ความคืบหน้า"
							aria-valuemin={0}
							aria-valuemax={progress.total}
							aria-valuenow={progress.succeeded + progress.failed.length}
							class="h-2 w-full overflow-hidden rounded-full bg-muted"
						>
							<div
								class="h-full bg-primary transition-[width]"
								style:width="{Math.round(progress.fraction * 100)}%"
							></div>
						</div>
						{#if progress.phase === 'done' && progress.failed.length > 0}
							<ul
								class="max-h-40 list-inside list-disc space-y-1 overflow-y-auto text-xs text-rose-900"
							>
								{#each progress.failed as item (item.id)}
									<li>
										<span class="font-medium">{nameById.get(item.id) ?? item.id}</span>
										— {item.error}
									</li>
								{/each}
							</ul>
							<div class="flex flex-wrap justify-end gap-2">
								<Button
									variant="ghost"
									class="h-11 px-4"
									disabled={busy}
									onclick={() => progress.reset()}
								>
									ปิดผลลัพธ์
								</Button>
								<Button class="h-11 gap-1.5 px-4" disabled={busy} onclick={retryFailed}>
									<RotateCw class="h-4 w-4" />
									ลองใหม่เฉพาะที่ล้มเหลว ({progress.failed.length})
								</Button>
							</div>
						{/if}
					</div>
				{/if}

				{#if selectedItems.length > 0 && progress.phase !== 'running'}
					<div class="flex flex-wrap items-center justify-between gap-2.5">
						<div class="flex flex-wrap items-center gap-2">
							<p class="text-sm font-semibold tabular-nums">
								{selectedItems.length} รายการที่เลือก
								{#if selectedStatus}
									<span class="font-normal text-muted-foreground">
										· {getStatusLabel(selectedStatus)}
									</span>
								{/if}
							</p>
							<Button variant="ghost" class="h-11 px-4" disabled={busy} onclick={clearSelection}>
								ล้างการเลือก
							</Button>
						</div>
						<div class="flex flex-wrap items-center justify-end gap-2.5">
							{#each commonActions as action (action.key)}
								{@render actionButton(action, () => askConfirm(action, selectedItems), false)}
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if confirmRequest}
		<ReferralConfirmDialog
			bind:open={confirmOpen}
			title={confirmTitles[confirmRequest.action.key]}
			names={confirmRequest.names}
			count={confirmRequest.ids.length}
			confirmLabel="{confirmLabels[confirmRequest.action.key]} {confirmRequest.ids.length} รายการ"
			destructive={confirmRequest.action.destructive}
			pending={busy}
			onConfirm={confirmRun}
		>
			{#if confirmRequest.action.asksReason}
				<div class="space-y-1.5">
					<label for="bulk-reason" class="text-sm font-medium text-slate-900">
						เหตุผล (ไม่บังคับ)
						{#if confirmRequest.ids.length > 1}
							<span class="font-normal text-slate-600">— ใช้กับทุกรายการ</span>
						{/if}
					</label>
					<Textarea
						id="bulk-reason"
						rows={3}
						maxlength={REFERRAL_REASON_MAX_LENGTH}
						placeholder="ระบุเหตุผลหรือคำอธิบายประกอบการพิจารณา..."
						bind:value={reasonInput}
					/>
					<p class="text-right text-xs text-slate-600 tabular-nums">
						{reasonInput.length}/{REFERRAL_REASON_MAX_LENGTH}
					</p>
				</div>
			{/if}
		</ReferralConfirmDialog>
	{/if}
</div>
