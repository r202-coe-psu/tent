<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import Eye from '@lucide/svelte/icons/eye';
	import type { Referral, ReferralStatus } from '../domain/referral.schema';

	let {
		referrals,
		onSelect,
		selectedId
	}: {
		referrals: Referral[];
		onSelect: (id: string) => void;
		selectedId: string | null;
	} = $props();

	// Status Tabs filtering
	let activeTab = $state<'all' | ReferralStatus>('all');

	const filteredReferrals = $derived(() => {
		if (activeTab === 'all') return referrals;
		return referrals.filter((r) => r.status === activeTab);
	});

	const tabs: { value: 'all' | ReferralStatus; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		{ value: 'draft', label: 'ฉบับร่าง (Draft)' },
		{ value: 'sent', label: 'ส่งแล้ว (Sent)' },
		{ value: 'accepted', label: 'ตอบรับแล้ว (Accepted)' },
		{ value: 'rejected', label: 'ปฏิเสธ (Rejected)' },
		{ value: 'closed', label: 'ปิดรายการ (Closed)' }
	];

	function getUrgencyStyle(urgency: string) {
		if (urgency === 'urgent') {
			return 'bg-red-500 hover:bg-red-600 text-white animate-pulse';
		}
		return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
	}

	function getStatusBadgeVariant(status: ReferralStatus) {
		switch (status) {
			case 'draft':
				return 'bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-950/20 dark:text-orange-400';
			case 'sent':
				return 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-950/20 dark:text-blue-400';
			case 'accepted':
				return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400';
			case 'rejected':
				return 'bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-950/20 dark:text-rose-400';
			case 'closed':
				return 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800/40 dark:text-slate-400';
		}
	}

	function getStatusLabel(status: ReferralStatus) {
		switch (status) {
			case 'draft':
				return 'ฉบับร่าง';
			case 'sent':
				return 'ส่งตัวแล้ว';
			case 'accepted':
				return 'ตอบรับแล้ว';
			case 'rejected':
				return 'ปฏิเสธรับ';
			case 'closed':
				return 'ปิดการส่งตัว';
		}
	}

	function formatDate(isoString: string) {
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

<div class="space-y-4">
	<!-- Tab Bar -->
	<div class="flex flex-wrap gap-1.5 border-b border-border pb-px">
		{#each tabs as tab}
			<button
				onclick={() => (activeTab = tab.value)}
				class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-all hover:text-foreground
				{activeTab === tab.value
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- List -->
	{#if filteredReferrals().length === 0}
		<div
			class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground"
		>
			<AlertCircle class="mb-4 h-10 w-10 text-muted-foreground/60" />
			<h3 class="mb-1 font-semibold text-foreground">ไม่พบข้อมูลรายการส่งต่อ</h3>
			<p class="text-sm">ไม่มีข้อมูลการส่งต่อที่ตรงกับเงื่อนไขในขณะนี้</p>
		</div>
	{:else}
		<div class="grid gap-3">
			{#each filteredReferrals() as referral (referral._id)}
				<button
					type="button"
					onclick={() => onSelect(referral._id)}
					class="group relative flex w-full cursor-pointer flex-col justify-between gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/50 md:flex-row md:items-center
					{selectedId === referral._id ? 'border-primary ring-2 ring-primary/10' : 'border-border/80'}"
				>
					<div class="min-w-0 flex-1 space-y-2">
						<div class="flex flex-wrap items-center gap-2">
							<Badge class={getUrgencyStyle(referral.urgency)}>
								{referral.urgency === 'urgent' ? 'ด่วนมาก' : 'ปกติ'}
							</Badge>
							<Badge class={getStatusBadgeVariant(referral.status)}>
								{getStatusLabel(referral.status)}
							</Badge>
							<span class="flex items-center gap-1 text-xs text-muted-foreground">
								<Clock class="h-3.5 w-3.5" />
								{formatDate(referral.created_at)}
							</span>
						</div>

						<div class="min-w-0">
							<p
								class="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary"
							>
								ส่งตัวไปยัง: {referral.to_org.name} ({referral.to_org.kind === 'hospital'
									? 'โรงพยาบาล'
									: referral.to_org.kind === 'social_services'
										? 'สังคมสงเคราะห์'
										: 'อื่น ๆ'})
							</p>
							<p class="mt-1 max-w-2xl truncate text-xs text-muted-foreground">
								เหตุผล: {referral.reason}
							</p>
						</div>
					</div>

					<div class="flex shrink-0 items-center gap-3 self-end md:self-center">
						<Button
							variant="ghost"
							size="sm"
							class="gap-1.5 text-xs text-muted-foreground group-hover:text-primary"
						>
							<Eye class="h-4 w-4" />
							รายละเอียด
						</Button>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
