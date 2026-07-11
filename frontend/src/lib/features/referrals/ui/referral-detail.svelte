<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Archive from '@lucide/svelte/icons/archive';
	import Send from '@lucide/svelte/icons/send';
	import Clock from '@lucide/svelte/icons/clock';
	import User from '@lucide/svelte/icons/user';

	import type { Referral, ReferralStatus } from '../domain/referral.schema';
	import { canTransition } from '../domain/referral.transitions';
	import { useTransitionReferral } from '../application/queries';
	import RedactionBanner from './redaction-banner.svelte';

	let { referral }: { referral: Referral } = $props();

	const queryClient = useQueryClient();
	const transitionMutation = useTransitionReferral(queryClient);

	async function handleTransition(to: ReferralStatus, label: string) {
		await toast.promise(transitionMutation.mutateAsync({ id: referral._id, to }), {
			loading: `กำลังเปลี่ยนสถานะเป็น "${label}"...`,
			success: `เปลี่ยนสถานะเป็น "${label}" สำเร็จ`,
			error: (err) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ')
		});
	}

	function getStatusLabel(status: ReferralStatus) {
		switch (status) {
			case 'draft':
				return 'ฉบับร่าง (Draft)';
			case 'sent':
				return 'ส่งตัวแล้ว (Sent)';
			case 'accepted':
				return 'ตอบรับการส่งต่อแล้ว (Accepted)';
			case 'rejected':
				return 'ปฏิเสธรับการส่งต่อ (Rejected)';
			case 'closed':
				return 'ปิดการส่งตัวแล้ว (Closed)';
		}
	}

	function getUrgencyStyle(urgency: string) {
		if (urgency === 'urgent') {
			return 'bg-red-500 hover:bg-red-600 text-white animate-pulse';
		}
		return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
	}

	function formatDate(isoString?: string) {
		if (!isoString) return '-';
		try {
			const d = new Date(isoString);
			return d.toLocaleString('th-TH', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return isoString;
		}
	}
</script>

<div class="space-y-6">
	<!-- Redaction warning for hospitals -->
	{#if referral.to_org.kind === 'hospital'}
		<RedactionBanner />
	{/if}

	<Card.Root class="border border-border/80 shadow-md">
		<Card.Header class="border-b border-border/60 bg-muted/30 pb-4">
			<div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<Card.Title class="flex items-center gap-2 text-xl font-bold">
						รายละเอียดใบส่งตัวผู้ลี้ภัย
					</Card.Title>
					<p class="mt-1 text-xs text-muted-foreground">ID: {referral._id}</p>
				</div>
				<div class="flex items-center gap-2">
					<Badge class={getUrgencyStyle(referral.urgency)}>
						{referral.urgency === 'urgent' ? 'ด่วนมาก' : 'ปกติ'}
					</Badge>
					<Badge variant="outline" class="font-semibold">
						{getStatusLabel(referral.status)}
					</Badge>
				</div>
			</div>
		</Card.Header>

		<Card.Content class="space-y-6 pt-6">
			<!-- Section 1: Evacuee Info -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold tracking-wider text-foreground uppercase">
					ผู้ลี้ภัยที่ส่งตัว
				</h3>
				<div class="rounded-lg border border-border/60 bg-muted/40 p-4">
					<div class="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
						<div>
							<p class="text-xs text-muted-foreground">รหัสผู้ลี้ภัย (Evacuee ID)</p>
							<p class="mt-0.5 font-mono font-medium">{referral.evacuee_id}</p>
						</div>
						<!-- In standard production, PII redacted by backend will hide first_name/last_name inside the JSON if Hospital scope is applied. -->
					</div>
				</div>
			</div>

			<!-- Section 2: Destination Org -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold tracking-wider text-foreground uppercase">
					ปลายทางที่ส่งต่อ
				</h3>
				<div class="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
					<div>
						<p class="text-xs text-muted-foreground">ชื่อหน่วยงาน</p>
						<p class="mt-0.5 font-medium">{referral.to_org.name}</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">ประเภทหน่วยงาน</p>
						<p class="mt-0.5 font-medium">
							{#if referral.to_org.kind === 'hospital'}
								สถานพยาบาล
							{:else}
								{referral.to_org.kind}
							{/if}
						</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">เบอร์โทรศัพท์ติดต่อ</p>
						<p class="mt-0.5 font-medium">{referral.to_org.contact || '-'}</p>
					</div>
				</div>
			</div>

			<!-- Section 3: Referral Medical Reason -->
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
								class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
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
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
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
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
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
								<span class="font-semibold text-slate-600">ปิดงานสมบูรณ์ (Closed):</span>
								<span class="text-muted-foreground">{formatDate(referral.timeline.closed.at)}</span>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {referral.timeline.closed.by}
								</span>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</Card.Content>

		<!-- Actions Footer (Matrix Gate transitions) -->
		<Card.Footer
			class="flex flex-wrap items-center justify-end gap-2.5 border-t border-border/60 bg-muted/20 py-4"
		>
			{#if canTransition(referral.status, 'sent')}
				<Button
					size="sm"
					variant="default"
					class="gap-1.5"
					onclick={() => handleTransition('sent', 'ส่งตัว')}
				>
					<Send class="h-4 w-4" />
					ส่งออกข้อมูล (Send)
				</Button>
			{/if}

			{#if canTransition(referral.status, 'accepted')}
				<Button
					size="sm"
					class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
					onclick={() => handleTransition('accepted', 'ตอบรับ')}
				>
					<CheckCircle2 class="h-4 w-4" />
					ตอบรับการส่งต่อ (Accept)
				</Button>
			{/if}

			{#if canTransition(referral.status, 'rejected')}
				<Button
					size="sm"
					variant="outline"
					class="gap-1.5 border-rose-300 text-rose-600 hover:bg-rose-50"
					onclick={() => handleTransition('rejected', 'ปฏิเสธ')}
				>
					<XCircle class="h-4 w-4" />
					ปฏิเสธรับการส่งต่อ (Reject)
				</Button>
			{/if}

			{#if canTransition(referral.status, 'closed')}
				<Button
					size="sm"
					variant="outline"
					class="gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-50"
					onclick={() => handleTransition('closed', 'ปิดรายการ')}
				>
					<Archive class="h-4 w-4" />
					ปิดรายการ (Close)
				</Button>
			{/if}
		</Card.Footer>
	</Card.Root>
</div>
