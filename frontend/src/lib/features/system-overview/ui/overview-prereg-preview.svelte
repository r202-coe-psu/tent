<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { PreRegistrationListItem } from '../domain';
	import { formatThaiDateTime } from '$lib/utils/date';

	let {
		items,
		total,
		loading = false
	}: {
		items: PreRegistrationListItem[] | undefined;
		total?: number;
		loading?: boolean;
	} = $props();

	function formatWhen(value: string | null): string {
		if (!value) return '—';
		return formatThaiDateTime(value) || value;
	}

	function originLabel(item: PreRegistrationListItem): string {
		return [item.province, item.district, item.subdistrict].filter(Boolean).join(' / ') || '—';
	}
	import PreRegStatusBadge from './prereg-status-badge.svelte';
	import PreRegShelterCell from './prereg-shelter-cell.svelte';
	import PreRegNameLink from './prereg-name-link.svelte';
</script>

<Card.Root class="rounded-xl border border-slate-200/80 bg-white shadow-2xs">
	<Card.Header class="flex flex-row items-start justify-between gap-3 space-y-0">
		<div class="space-y-1">
			<Card.Title class="text-lg font-bold text-slate-900">Pre-registrations</Card.Title>
			<Card.Description class="text-sm text-slate-500">
				{#if total != null}
					แสดงตัวอย่าง · ทั้งหมด {total.toLocaleString('th-TH')} รายการ
				{:else}
					แสดงตัวอย่างรายการล่าสุด
				{/if}
			</Card.Description>
		</div>
		<Button variant="outline" size="sm" href={resolve('/system-management/pre-registrations')}>
			ดูทั้งหมด
		</Button>
	</Card.Header>
	<Card.Content>
		{#if loading && !items}
			<Skeleton class="h-40 w-full rounded-xl" />
		{:else if !items || items.length === 0}
			<p class="py-6 text-center text-sm text-slate-500">ไม่พบรายการลงทะเบียนล่วงหน้า</p>
		{:else}
			<ul
				role="list"
				class="divide-y rounded-xl border border-slate-200/80 md:hidden"
				data-testid="prereg-preview-cards"
			>
				{#each items as item (item.id)}
					<li class="space-y-1.5 p-3 text-sm">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div class="min-w-0"><PreRegNameLink {item} /></div>
							<PreRegStatusBadge {item} />
						</div>
						<div class="break-words"><PreRegShelterCell {item} /></div>
						<p class="break-words text-slate-700">ต้นทาง: {originLabel(item)}</p>
						<p class="text-xs text-slate-500 tabular-nums">{formatWhen(item.registered_at)}</p>
					</li>
				{/each}
			</ul>
			<div class="hidden overflow-x-auto rounded-xl border border-slate-200/80 md:block">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>ชื่อ</Table.Head>
							<Table.Head>สถานะการเข้าศูนย์</Table.Head>
							<Table.Head>ศูนย์พักพิง</Table.Head>
							<Table.Head>ต้นทาง</Table.Head>
							<Table.Head>เวลา</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each items as item (item.id)}
							<Table.Row>
								<Table.Cell>
									<PreRegNameLink {item} />
								</Table.Cell>
								<Table.Cell>
									<PreRegStatusBadge {item} />
								</Table.Cell>
								<Table.Cell>
									<PreRegShelterCell {item} />
								</Table.Cell>
								<Table.Cell class="text-sm text-slate-700">{originLabel(item)}</Table.Cell>
								<Table.Cell class="text-sm text-slate-700 tabular-nums">
									{formatWhen(item.registered_at)}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
