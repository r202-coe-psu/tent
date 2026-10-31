<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Archive from '@lucide/svelte/icons/archive';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import FilePen from '@lucide/svelte/icons/file-pen';
	import Layers from '@lucide/svelte/icons/layers';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Search from '@lucide/svelte/icons/search';
	import Send from '@lucide/svelte/icons/send';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Users from '@lucide/svelte/icons/users';
	import type { Component } from 'svelte';
	import type {
		Referral,
		ReferralDirectionFilter,
		ReferralStatus
	} from '../domain/referral.schema';
	import { groupReferralsForList, type ReferralListGroup } from '../domain/referral.batch-group';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		formatReferralDate,
		getStatusBadgeVariant,
		getStatusLabel,
		getUrgencyLabel,
		referralBatchPath,
		referralDetailPath,
		resolveEvacueeName
	} from './referral.ui-helpers';

	type StatusTab = 'all' | ReferralStatus;

	let {
		referrals,
		direction = 'outgoing',
		onDirectionChange,
		status = 'all',
		onStatusChange,
		search = '',
		onSearchChange,
		isLoading = false,
		isError = false,
		onRetry,
		hasMore = false,
		isFetchingMore = false,
		isLoadMoreError = false,
		onLoadMore
	}: {
		referrals: Referral[];
		/** Server query inputs — the parent owns them (URL) and refetches on change. */
		direction?: ReferralDirectionFilter;
		onDirectionChange?: (next: ReferralDirectionFilter) => void;
		status?: StatusTab;
		onStatusChange?: (next: StatusTab) => void;
		/** Client-side filter over loaded rows; the parent mirrors it into the URL. */
		search?: string;
		onSearchChange?: (next: string) => void;
		isLoading?: boolean;
		isError?: boolean;
		onRetry?: () => void;
		hasMore?: boolean;
		isFetchingMore?: boolean;
		isLoadMoreError?: boolean;
		onLoadMore?: () => void;
	} = $props();

	/** Names come from the referral's own `evacuee_summary` snapshot — no evacuee roster is loaded. */
	function getEvacueeName(referral: Referral): string {
		return resolveEvacueeName(referral.evacuee_summary);
	}

	// Typing updates this immediately; it re-syncs whenever the `search` prop changes (URL back/forward).
	let searchInput = $derived(search);

	const filteredGroups = $derived.by(() => {
		let list = referrals;
		const query = searchInput.toLowerCase().trim();
		if (query) {
			list = list.filter((r) => {
				const evacName = getEvacueeName(r).toLowerCase();
				const orgName = r.to_org?.name?.toLowerCase() ?? r.to_shelter_code?.toLowerCase() ?? '';
				const evacId = r.evacuee_id.toLowerCase();
				return evacName.includes(query) || orgName.includes(query) || evacId.includes(query);
			});
		}
		return groupReferralsForList(list);
	});

	const shownCount = $derived(filteredGroups.reduce((n, g) => n + g.count, 0));

	const tabs: { value: StatusTab; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		{ value: 'draft', label: 'ฉบับร่าง (Draft)' },
		{ value: 'sent', label: 'ส่งแล้ว (Sent)' },
		{ value: 'accepted', label: 'ตอบรับแล้ว (Accepted)' },
		{ value: 'rejected', label: 'ปฏิเสธ (Rejected)' },
		{ value: 'closed', label: 'ปิดรายการ (Closed)' }
	];

	const directions: { value: ReferralDirectionFilter; label: string }[] = [
		{ value: 'outgoing', label: 'ขาออก' },
		{ value: 'incoming', label: 'ขาเข้า' }
	];

	const statusIcons: Record<ReferralStatus, Component> = {
		draft: FilePen,
		sent: Send,
		accepted: CircleCheck,
		rejected: CircleX,
		closed: Archive
	};

	/** Single referral opens its detail; a multi-member group opens the batch page. */
	function groupHref(group: ReferralListGroup): string {
		return group.count > 1
			? referralBatchPath(group.sample._id)
			: referralDetailPath(group.sample._id);
	}

	function primaryLabel(group: ReferralListGroup): string {
		if (group.count > 1) {
			return `ชุดส่งต่อ ${group.count} คน`;
		}
		return getEvacueeName(group.sample);
	}

	/** Outgoing tab shows where it goes; incoming tab shows where it came from. */
	function counterpartLabel(referral: Referral): string {
		if (direction === 'incoming') return referral.shelter_code || '-';
		return referral.to_shelter_code || referral.to_org?.name || '-';
	}

	const counterpartHeader = $derived(direction === 'incoming' ? 'ต้นทาง' : 'ปลายทาง');

	const rowFocus =
		'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none';
</script>

{#snippet statusBadge(group: ReferralListGroup)}
	{#if group.sharedStatus}
		{@const Icon = statusIcons[group.sharedStatus]}
		<Badge class="{getStatusBadgeVariant(group.sharedStatus)} gap-1 text-xs font-semibold">
			<Icon class="h-3.5 w-3.5" aria-hidden="true" />
			{getStatusLabel(group.sharedStatus)}
		</Badge>
	{:else}
		<Badge
			class="gap-1 bg-amber-100 text-xs font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
		>
			<Layers class="h-3.5 w-3.5" aria-hidden="true" />
			หลายสถานะ
		</Badge>
	{/if}
{/snippet}

{#snippet badges(group: ReferralListGroup)}
	{#if group.count > 1}
		<Badge
			class="gap-1 bg-sky-100 text-xs font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
		>
			<Users class="h-3.5 w-3.5" aria-hidden="true" />
			{group.count} คน
		</Badge>
	{/if}
	{#if group.sample.urgency === 'urgent'}
		<Badge class="gap-1 border border-red-200 bg-red-50 text-xs font-semibold text-red-900">
			<TriangleAlert class="h-3.5 w-3.5" aria-hidden="true" />
			{getUrgencyLabel(group.sample.urgency)}
		</Badge>
	{/if}
{/snippet}

<div class="space-y-4">
	<div class="relative w-full">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
			<Search class="h-4 w-4 text-muted-foreground" />
		</div>
		<Input
			type="text"
			bind:value={searchInput}
			oninput={() => onSearchChange?.(searchInput)}
			aria-label="ค้นหารายการส่งต่อ"
			placeholder="ค้นหาชื่อผู้เข้าพัก หรือหน่วยงาน/ศูนย์พักพิงปลายทาง..."
			class="h-11 bg-background pl-9 placeholder:text-base md:placeholder:text-sm"
		/>
	</div>

	<!-- Direction (server query) -->
	<div
		role="tablist"
		aria-label="ทิศทางการส่งต่อ"
		class="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
	>
		{#each directions as d (d.value)}
			{@const isActive = direction === d.value}
			<button
				type="button"
				role="tab"
				aria-selected={isActive}
				onclick={() => {
					if (!isActive) onDirectionChange?.(d.value);
				}}
				class="min-h-11 rounded-md px-5 text-sm transition-colors {rowFocus}
				{isActive
					? 'bg-card font-semibold text-primary shadow-xs'
					: 'font-medium text-muted-foreground hover:text-foreground'}"
			>
				{d.label}
			</button>
		{/each}
	</div>

	<!-- Status tabs (server query) -->
	<div
		role="group"
		aria-label="กรองตามสถานะ"
		class="flex flex-wrap gap-1.5 border-b border-border pb-px"
	>
		{#each tabs as tab (tab.value)}
			{@const isActive = status === tab.value}
			<button
				type="button"
				aria-pressed={isActive}
				onclick={() => {
					if (status !== tab.value) onStatusChange?.(tab.value);
				}}
				class="-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-4 text-sm transition-all hover:text-foreground {rowFocus}
				{isActive
					? 'border-primary font-semibold text-primary'
					: 'border-transparent font-medium text-muted-foreground hover:border-border'}"
			>
				{#if isActive}
					<Check class="h-3.5 w-3.5" aria-hidden="true" />
				{/if}
				{tab.label}
			</button>
		{/each}
	</div>

	{#if isLoading}
		<div class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
			<Loader2 class="h-8 w-8 animate-spin text-primary" />
			<span class="text-sm">กำลังโหลดข้อมูล...</span>
		</div>
	{:else if isError}
		<div
			role="alert"
			class="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-white py-12 text-center"
		>
			<TriangleAlert class="h-8 w-8 text-red-600" />
			<h3 class="font-semibold text-foreground">โหลดรายการส่งต่อไม่สำเร็จ</h3>
			<p class="text-sm text-muted-foreground">กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
			<Button variant="outline" onclick={() => onRetry?.()} class="h-11 gap-2">
				<RotateCw class="h-4 w-4" />
				ลองใหม่
			</Button>
		</div>
	{:else if filteredGroups.length === 0}
		<div
			class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground"
		>
			<AlertCircle class="mb-4 h-10 w-10 text-muted-foreground/60" />
			<h3 class="mb-1 font-semibold text-foreground">ไม่พบข้อมูลรายการส่งต่อ</h3>
			<p class="text-sm">ไม่มีข้อมูลการส่งต่อที่ตรงกับเงื่อนไขในขณะนี้</p>
		</div>
	{:else}
		<!-- Desktop: table, one stretched link per row -->
		<div class="hidden rounded-xl border border-border/80 bg-card shadow-2xs md:block">
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>รายการ</Table.Head>
						<Table.Head>{counterpartHeader}</Table.Head>
						<Table.Head>เหตุผล</Table.Head>
						<Table.Head>สถานะ</Table.Head>
						<Table.Head>วันที่สร้าง</Table.Head>
						<Table.Head class="w-10"><span class="sr-only">เปิด</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filteredGroups as group (group.key)}
						<Table.Row class="relative">
							<Table.Cell class="max-w-64">
								<div class="flex flex-wrap items-center gap-2">
									<a
										href={groupHref(group)}
										class="inline-flex min-h-11 items-center truncate rounded-sm text-sm font-bold text-foreground after:absolute after:inset-0 {rowFocus}"
									>
										{primaryLabel(group)}
									</a>
									{@render badges(group)}
								</div>
							</Table.Cell>
							<Table.Cell class="text-sm">{counterpartLabel(group.sample)}</Table.Cell>
							<Table.Cell class="max-w-56 truncate text-sm text-muted-foreground">
								{group.sample.reason}
							</Table.Cell>
							<Table.Cell>{@render statusBadge(group)}</Table.Cell>
							<Table.Cell class="text-sm whitespace-nowrap text-muted-foreground tabular-nums">
								{formatReferralDate(group.createdAt)}
							</Table.Cell>
							<Table.Cell>
								<ChevronRight class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>

		<!-- Below md: one card per row -->
		<ul class="space-y-2 md:hidden">
			{#each filteredGroups as group (group.key)}
				<li>
					<a
						href={groupHref(group)}
						class="flex min-h-11 flex-col gap-2 rounded-xl border border-border/80 bg-card p-4 shadow-2xs transition-colors hover:border-primary/50 hover:bg-accent/50 {rowFocus}"
					>
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-sm font-bold text-foreground">{primaryLabel(group)}</span>
							{@render badges(group)}
						</div>
						<div class="text-sm text-muted-foreground">
							{counterpartHeader}:
							<span class="text-foreground">{counterpartLabel(group.sample)}</span>
						</div>
						{#if group.sample.reason}
							<div class="text-sm text-muted-foreground">{group.sample.reason}</div>
						{/if}
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div class="flex flex-wrap items-center gap-2">
								{@render statusBadge(group)}
								<span class="text-xs text-muted-foreground tabular-nums">
									{formatReferralDate(group.createdAt)}
								</span>
							</div>
							<ChevronRight class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<!-- Footer: load more -->
	{#if !isLoading && !isError && referrals.length > 0}
		<div
			class="mt-4 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row"
		>
			<div class="space-y-0.5 text-center font-sans text-xs text-muted-foreground sm:text-left">
				<div>แสดง {shownCount} รายการ</div>
				{#if isLoadMoreError}
					<div role="alert" class="font-medium text-red-700">โหลดรายการเพิ่มไม่สำเร็จ</div>
				{/if}
				{#if hasMore && searchInput.trim()}
					<div role="status">ค้นหาเฉพาะรายการที่โหลดแล้ว</div>
				{/if}
			</div>

			{#if hasMore}
				<Button
					variant="outline"
					onclick={() => onLoadMore?.()}
					disabled={isFetchingMore}
					class="h-11 gap-2"
				>
					{#if isFetchingMore}
						<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
					{/if}
					โหลดเพิ่ม
				</Button>
			{:else}
				<span class="text-xs text-muted-foreground">ไม่มีรายการเพิ่มเติม</span>
			{/if}
		</div>
	{/if}
</div>
