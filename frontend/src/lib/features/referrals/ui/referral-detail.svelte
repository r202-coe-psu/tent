<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Archive from '@lucide/svelte/icons/archive';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Ban from '@lucide/svelte/icons/ban';
	import Send from '@lucide/svelte/icons/send';
	import Clock from '@lucide/svelte/icons/clock';
	import User from '@lucide/svelte/icons/user';

	import type { Referral, ReferralStatus } from '../domain/referral.schema';
	import { canTransition } from '../domain/referral.transitions';
	import {
		canActorRespond,
		isIncomingCapacityReferral,
		isOutgoingCapacityReferral
	} from '../domain/referral.authorization';
	import { useTransitionReferral } from '../application/queries';
	import { getShelterCode } from '$lib/db/shelter';
	import RedactionBanner from './redaction-banner.svelte';
	import ReferralConfirmDialog from './referral-confirm-dialog.svelte';
	import {
		formatEvacueeFullName,
		formatReferralDate as formatDate,
		getClosedSubLabel,
		getKindLabel,
		getStatusLabel,
		getUrgencyLabel,
		getUrgencyStyle,
		resolveEvacueeName
	} from './referral.ui-helpers';

	let { referral }: { referral: Referral } = $props();

	const queryClient = useQueryClient();
	const transitionMutation = useTransitionReferral(queryClient);

	let responseReasonInput = $state('');
	let showReasonPrompt = $state<'accepted' | 'rejected' | 'withdraw' | null>(null);
	let transitionInFlight = $state(false);
	const isTransitionBusy = $derived(transitionMutation.isPending || transitionInFlight);

	type ConfirmRequest = {
		title: string;
		description?: string;
		names: string[];
		count: number;
		confirmLabel: string;
		destructive?: boolean;
		run: () => Promise<unknown>;
	};
	let confirmOpen = $state(false);
	let confirmRequest = $state.raw<ConfirmRequest | null>(null);
	const subjectNames = $derived([resolveEvacueeName(referral.evacuee_summary)]);

	const actorShelter = $derived(getShelterCode());
	const canRespond = $derived(canActorRespond(referral, actorShelter));
	const awaitingDest = $derived(
		isOutgoingCapacityReferral(referral, actorShelter) && referral.status === 'sent'
	);
	const isIncoming = $derived(isIncomingCapacityReferral(referral, actorShelter));
	const canSend = $derived(
		canTransition(referral.status, 'sent') &&
			(!referral.referral_type ||
				referral.referral_type !== 'capacity' ||
				isOutgoingCapacityReferral(referral, actorShelter))
	);
	const canClose = $derived(
		canTransition(referral.status, 'closed') &&
			(referral.referral_type !== 'capacity' || isOutgoingCapacityReferral(referral, actorShelter))
	);

	// CR-167: `sent → closed` is a withdraw (source only), shown as its own button + reason prompt.
	const canWithdraw = $derived(canClose && referral.status === 'sent');
	const closedSubLabel = $derived(
		getClosedSubLabel(referral, isIncoming ? 'destination' : 'source')
	);
	const promptLabel = $derived(
		showReasonPrompt === 'accepted'
			? 'ตอบรับ'
			: showReasonPrompt === 'rejected'
				? 'ปฏิเสธ'
				: 'ถอนคำขอ'
	);

	async function handleTransition(to: ReferralStatus, label: string, reason?: string) {
		// Synchronous guard: TanStack's isPending reaches the DOM only after a batched flush,
		// so a second click in the same tick would otherwise send a second request.
		if (transitionMutation.isPending || transitionInFlight) return;
		transitionInFlight = true;
		const mutation = transitionMutation.mutateAsync({ id: referral._id, to, reason });
		// toast.promise returns void; it does not wait for the mutation, so await `mutation` directly.
		void toast.promise(mutation, {
			loading: `กำลังเปลี่ยนสถานะเป็น "${label}"...`,
			success: `เปลี่ยนสถานะเป็น "${label}" สำเร็จ`,
			error: (err) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ')
		});
		try {
			await mutation;
		} catch {
			// toast.promise already surfaced the error
		} finally {
			transitionInFlight = false;
			showReasonPrompt = null;
			responseReasonInput = '';
		}
	}

	function triggerActionWithReason(to: 'accepted' | 'rejected' | 'withdraw') {
		showReasonPrompt = to;
	}

	function askConfirm(request: ConfirmRequest) {
		confirmRequest = request;
		confirmOpen = true;
	}

	function confirmSend() {
		askConfirm({
			title: 'ยืนยันการส่งตัว',
			names: subjectNames,
			count: 1,
			confirmLabel: 'ส่งตัว',
			run: () => handleTransition('sent', 'ส่งตัว')
		});
	}

	function confirmCancelDraft() {
		askConfirm({
			title: 'ยืนยันการยกเลิกร่าง',
			names: subjectNames,
			count: 1,
			confirmLabel: 'ยกเลิกร่าง',
			destructive: true,
			run: () => handleTransition('closed', 'ยกเลิกร่าง')
		});
	}

	function confirmClose() {
		askConfirm({
			title: 'ยืนยันการปิดรายการ',
			names: subjectNames,
			count: 1,
			confirmLabel: 'ปิดรายการ',
			destructive: true,
			run: () => handleTransition('closed', 'ปิดรายการ')
		});
	}

	function submitWithReason() {
		if (!showReasonPrompt) return;
		const prompt = showReasonPrompt;
		const to: ReferralStatus = prompt === 'withdraw' ? 'closed' : prompt;
		const label = promptLabel;
		const reason = responseReasonInput.trim();
		askConfirm({
			title: `ยืนยันการ${label}`,
			description: reason
				? `เหตุผลนี้จะใช้กับ 1 รายการ: ${reason}`
				: 'ไม่ได้ระบุเหตุผล จะใช้กับ 1 รายการ',
			names: subjectNames,
			count: 1,
			confirmLabel: prompt === 'withdraw' ? label : `ยืนยัน${label}`,
			destructive: prompt !== 'accepted',
			run: () => handleTransition(to, label, reason)
		});
	}
</script>

<div class="space-y-6">
	<!-- Redaction warning for hospitals -->
	{#if referral.referral_type === 'medical-emergency' || referral.to_org?.kind === 'hospital'}
		<RedactionBanner />
	{/if}

	{#if isIncoming && referral.status === 'sent'}
		<div
			class="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
			role="status"
		>
			คำขอย้ายเข้าจากศูนย์ <span class="font-semibold tabular-nums">{referral.shelter_code}</span> — ตอบรับแล้วระบบจะย้ายผู้เข้าพักเข้าศูนย์นี้
			(occupancy สองฝั่งจะอัปเดตหลังตอบรับเท่านั้น)
		</div>
	{/if}

	{#if awaitingDest}
		<div
			class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
			role="status"
		>
			รอศูนย์ปลายทาง
			<span class="font-semibold tabular-nums">{referral.to_shelter_code}</span>
			ตอบรับหรือปฏิเสธ — การย้ายศูนย์จะเกิดขึ้นเมื่อปลายทางกดตอบรับเท่านั้น
		</div>
	{/if}

	<Card.Root class="border border-border/80 shadow-2xs">
		<Card.Header class="border-b border-border/60 bg-muted/30 pb-4">
			<div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<Card.Title class="flex items-center gap-2 text-xl font-bold">
						รายละเอียดใบส่งตัวผู้เข้าพัก
					</Card.Title>
					<p class="mt-1 text-xs text-muted-foreground">ID: {referral._id}</p>
				</div>
				<div class="flex items-center gap-2">
					<Badge variant="secondary" class="font-medium">
						{getKindLabel(referral.referral_type)}
					</Badge>
					<Badge class={getUrgencyStyle(referral.urgency)}>
						{getUrgencyLabel(referral.urgency)}
					</Badge>
					<Badge variant="outline" class="font-semibold">
						{getStatusLabel(referral.status, { verbose: true })}
					</Badge>
					{#if closedSubLabel}
						<Badge variant="secondary" class="font-medium" data-testid="closed-sub-label">
							{closedSubLabel}
						</Badge>
					{/if}
				</div>
			</div>
		</Card.Header>

		<Card.Content class="space-y-6 pt-6">
			<!-- Section 1: Evacuee Info -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold tracking-wider text-foreground uppercase">
					ผู้เข้าพักที่ส่งตัว
				</h3>
				<div class="rounded-lg border border-border/60 bg-muted/40 p-4">
					<div class="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
						{#if referral.evacuee_summary}
							<div>
								<p class="text-xs text-muted-foreground">ชื่อ-นามสกุล ผู้เข้าพัก</p>
								<p class="mt-0.5 text-base font-semibold text-foreground">
									{formatEvacueeFullName(referral.evacuee_summary)}
								</p>
							</div>
						{/if}
						<div>
							<p class="text-xs text-muted-foreground">รหัสผู้เข้าพัก (Evacuee ID)</p>
							<p class="mt-0.5 font-medium tabular-nums">{referral.evacuee_id}</p>
						</div>
					</div>
				</div>
			</div>

			<!-- Section 2: Destination Org / Shelter -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold tracking-wider text-foreground uppercase">
					ปลายทางที่ส่งต่อ
				</h3>
				<div class="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
					{#if referral.referral_type === 'capacity' || referral.to_shelter_code}
						<div>
							<p class="text-xs text-muted-foreground">ศูนย์พักพิงปลายทาง (Target Shelter)</p>
							<p class="mt-0.5 font-semibold text-primary tabular-nums">
								{referral.to_shelter_code || '-'}
							</p>
						</div>
					{/if}

					{#if referral.to_org}
						<div>
							<p class="text-xs text-muted-foreground">ชื่อหน่วยงาน</p>
							<p class="mt-0.5 font-medium">{referral.to_org.name || '-'}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">ประเภทหน่วยงาน</p>
							<p class="mt-0.5 font-medium">
								{#if referral.to_org.kind === 'hospital'}
									สถานพยาบาล
								{:else if referral.to_org.kind === 'social_services'}
									หน่วยงานสังคมสงเคราะห์
								{:else}
									{referral.to_org.kind || '-'}
								{/if}
							</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">เบอร์โทรศัพท์ติดต่อ</p>
							<p class="mt-0.5 font-medium">{referral.to_org.contact || '-'}</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- Section 3: Referral Medical / Resource Reason -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold tracking-wider text-foreground uppercase">
					เหตุผลความจำเป็นในการส่งต่อ
				</h3>
				<p
					class="rounded-md border border-border/40 bg-muted/20 p-3 text-sm whitespace-pre-wrap text-foreground"
				>
					{referral.reason}
				</p>
			</div>

			<!-- Response Reason if present -->
			{#if referral.response_reason}
				<div class="space-y-3">
					<h3
						class="text-sm font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400"
					>
						เหตุผลการตอบรับ/ปฏิเสธจากปลายทาง (Response Reason)
					</h3>
					<p
						class="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 text-sm font-medium whitespace-pre-wrap text-emerald-900 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-200"
					>
						{referral.response_reason}
					</p>
				</div>
			{/if}

			<!-- Notes -->
			{#if referral.notes}
				<div class="space-y-3">
					<h3 class="text-sm font-semibold tracking-wider text-foreground uppercase">
						หมายเหตุเพิ่มเติม
					</h3>
					<p
						class="rounded-md border border-border/40 bg-muted/20 p-3 text-sm whitespace-pre-wrap text-foreground"
					>
						{referral.notes}
					</p>
				</div>
			{/if}

			<!-- Prompt for Response Reason before Accept/Reject -->
			{#if showReasonPrompt}
				<div class="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
					<h4 class="text-sm font-semibold text-foreground">
						{#if showReasonPrompt === 'withdraw'}
							ระบุเหตุผลการถอนคำขอ (ไม่บังคับ)
						{:else}
							ระบุเหตุผลการ{promptLabel} (Response Reason)
						{/if}
					</h4>
					<Input
						type="text"
						placeholder="ระบุเหตุผลหรือคำอธิบายประกอบการพิจารณา..."
						bind:value={responseReasonInput}
					/>
					<div class="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onclick={() => (showReasonPrompt = null)}>
							ยกเลิก
						</Button>
						<Button
							size="sm"
							variant={showReasonPrompt === 'accepted' ? 'default' : 'destructive'}
							onclick={submitWithReason}
							disabled={isTransitionBusy}
						>
							ยืนยันการ{promptLabel}
						</Button>
					</div>
				</div>
			{/if}

			<!-- Section 4: Timeline Audit Trail -->
			<div class="space-y-4 border-t border-border/60 pt-4">
				<h3
					class="flex items-center gap-1.5 text-sm font-semibold tracking-wider text-foreground uppercase"
				>
					<Clock class="h-4 w-4 text-muted-foreground" />
					บันทึกประวัติการส่งตัว (Timeline Audit Trail)
				</h3>

				<div class="relative ml-3 space-y-4 border-l border-border pl-6">
					<!-- Created stamp -->
					<div class="relative">
						<div
							class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary bg-background p-1"
						></div>
						<div class="text-xs">
							<span class="font-semibold">ลงบันทึกใบร่างครั้งแรก:</span>
							<span class="text-muted-foreground">{formatDate(referral.created_at)}</span>
							<span
								class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
							>
								<User class="h-3 w-3" /> By: {referral.created_by}
							</span>
						</div>
					</div>

					<!-- Sent stamp -->
					{#if referral.timeline?.sent}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-blue-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-blue-600">ส่งข้อมูลออก (Sent):</span>
								<span class="text-muted-foreground">{formatDate(referral.timeline.sent.at)}</span>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {referral.timeline.sent.by}
								</span>
							</div>
						</div>
					{/if}

					<!-- Responded stamp -->
					{#if referral.timeline?.responded}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-emerald-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-emerald-600"
									>หน่วยงานปลายทางตอบสนอง (Responded):</span
								>
								<span class="text-muted-foreground"
									>{formatDate(referral.timeline.responded.at)}</span
								>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {referral.timeline.responded.by}
								</span>
							</div>
						</div>
					{/if}

					<!-- Closed stamp -->
					{#if referral.timeline?.closed}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-slate-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-slate-600">ปิดรายการ (Closed):</span>
								<span class="text-muted-foreground">{formatDate(referral.timeline.closed.at)}</span>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {referral.timeline.closed.by}
								</span>
							</div>
							{#if referral.close_reason}
								<p
									class="mt-1 text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-300"
									data-testid="close-reason"
								>
									เหตุผล: {referral.close_reason}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</Card.Content>

		<!-- Actions Footer (Matrix Gate transitions; capacity accept = destination only) -->
		<Card.Footer
			class="flex flex-wrap items-center justify-end gap-2.5 border-t border-border/60 bg-muted/20 py-4"
		>
			{#if canSend}
				<Button
					size="sm"
					variant="default"
					class="gap-1.5"
					onclick={confirmSend}
					disabled={isTransitionBusy}
				>
					<Send class="h-4 w-4" />
					ส่งออกข้อมูล (Send)
				</Button>
			{/if}

			{#if canRespond && canTransition(referral.status, 'accepted')}
				<Button
					size="sm"
					class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
					onclick={() => triggerActionWithReason('accepted')}
					disabled={isTransitionBusy}
				>
					<CheckCircle2 class="h-4 w-4" />
					ตอบรับการส่งต่อ (Accept)
				</Button>
			{/if}

			{#if canRespond && canTransition(referral.status, 'rejected')}
				<Button
					size="sm"
					variant="outline"
					class="gap-1.5 border-rose-300 text-rose-600 hover:bg-rose-50"
					onclick={() => triggerActionWithReason('rejected')}
					disabled={isTransitionBusy}
				>
					<XCircle class="h-4 w-4" />
					ปฏิเสธรับการส่งต่อ (Reject)
				</Button>
			{/if}

			{#if canWithdraw}
				<Button
					size="sm"
					variant="outline"
					class="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
					data-testid="btn-withdraw-referral"
					onclick={() => triggerActionWithReason('withdraw')}
					disabled={isTransitionBusy}
				>
					<Undo2 class="h-4 w-4" />
					ถอนคำขอ
				</Button>
			{:else if canClose}
				{#if referral.status === 'draft'}
					<Button
						size="sm"
						variant="outline"
						class="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
						onclick={confirmCancelDraft}
						disabled={isTransitionBusy}
					>
						<Ban class="h-4 w-4" />
						ยกเลิกร่าง
					</Button>
				{:else}
					<Button
						size="sm"
						variant="outline"
						class="gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-50"
						data-testid="btn-close-referral"
						disabled={isTransitionBusy}
						onclick={confirmClose}
					>
						<Archive class="h-4 w-4" />
						ปิดรายการ (Close)
					</Button>
				{/if}
			{/if}
		</Card.Footer>
	</Card.Root>
	<ReferralConfirmDialog
		bind:open={confirmOpen}
		title={confirmRequest?.title ?? ''}
		description={confirmRequest?.description}
		names={confirmRequest?.names ?? []}
		count={confirmRequest?.count ?? 0}
		confirmLabel={confirmRequest?.confirmLabel ?? ''}
		destructive={confirmRequest?.destructive}
		pending={isTransitionBusy}
		onConfirm={() => confirmRequest?.run()}
	/>
</div>
