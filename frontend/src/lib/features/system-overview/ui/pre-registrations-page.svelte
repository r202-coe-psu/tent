<script lang="ts">
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { AGE_BUCKET_LABELS } from '$lib/features/dashboard';
	import {
		overviewFiltersSchema,
		type OverviewFilters,
		type PreRegistrationListItem
	} from '../domain';
	import { usePreRegistrations } from '../application/queries';
	import { formatThaiDateTime } from '$lib/utils/date';
	import OverviewFilterBar from './overview-filter-bar.svelte';

	let filters = $state<OverviewFilters>(overviewFiltersSchema.parse({}));

	const listQuery = usePreRegistrations(() => filters);

	const items = $derived(listQuery.data?.items ?? []);
	const total = $derived(listQuery.data?.total ?? 0);
	const limit = $derived(filters.limit);
	const offset = $derived(filters.offset);
	const pageStart = $derived(total === 0 ? 0 : offset + 1);
	const pageEnd = $derived(Math.min(offset + limit, total));
	const canPrev = $derived(offset > 0);
	const canNext = $derived(offset + limit < total);

	function onFiltersChange(next: OverviewFilters) {
		const resetOffset =
			next.site_kind !== filters.site_kind ||
			next.operation_status !== filters.operation_status ||
			next.stay_bucket !== filters.stay_bucket ||
			next.source !== filters.source ||
			next.household_id !== filters.household_id ||
			next.q !== filters.q ||
			next.limit !== filters.limit;
		filters = resetOffset ? { ...next, offset: 0 } : next;
	}

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

{#snippet household(item: PreRegistrationListItem)}
	{#if item.household_name}
		<span title={item.household_id ?? undefined}>{item.household_name}</span>
	{:else if item.household_id}
		<span class="font-mono text-xs text-slate-500">{item.household_id}</span>
	{:else}
		<span class="text-slate-400">—</span>
	{/if}
{/snippet}

{#snippet sourceBadge(item: PreRegistrationListItem)}
	{#if item.source === 'unassigned'}
		<span
			class="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
		>
			ส่วนกลาง
		</span>
	{:else}
		<span
			class="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-700"
		>
			{item.shelter_code ?? 'ผูกศูนย์'}
		</span>
	{/if}
{/snippet}

<StaffPageShell
	title="ลงทะเบียนล่วงหน้า"
	description="ตรวจสอบผู้ลงทะเบียนล่วงหน้าทั้งหมด สถานะการเข้าศูนย์ และศูนย์พักพิงปลายทาง"
>
	<OverviewFilterBar {filters} onChange={onFiltersChange} showHouseholdFilter={true} />

	{#if listQuery.isError}
		<Alert variant="destructive">
			<AlertCircle class="h-4 w-4" />
			<AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
			<AlertDescription>ไม่สามารถโหลดรายการลงทะเบียนล่วงหน้าได้</AlertDescription>
		</Alert>
	{/if}

	<div class={spatial.container.staffPageCard}>
		<div
			class="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 p-4 sm:p-6"
		>
			<div>
				<h2 class="text-lg font-bold text-slate-900">รายการทั้งหมด</h2>
				<p class="text-sm text-slate-500">
					{#if listQuery.isPending && items.length === 0}
						กำลังโหลด...
					{:else}
						แสดง {pageStart.toLocaleString('th-TH')}–{pageEnd.toLocaleString('th-TH')} จาก
						{total.toLocaleString('th-TH')}
					{/if}
				</p>
			</div>
			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={!canPrev || listQuery.isPending}
					onclick={() => {
						filters = { ...filters, offset: Math.max(0, offset - limit) };
					}}
				>
					ก่อนหน้า
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={!canNext || listQuery.isPending}
					onclick={() => {
						filters = { ...filters, offset: offset + limit };
					}}
				>
					ถัดไป
				</Button>
			</div>
		</div>
		<div class="p-4 sm:p-6">
			{#if listQuery.isPending && items.length === 0}
				<Skeleton class="h-48 w-full rounded-xl" />
			{:else if items.length === 0}
				<p class="py-8 text-center text-sm text-slate-500">ไม่พบรายการ</p>
			{:else}
				<ul
					role="list"
					class="divide-y rounded-xl border border-slate-200/80 md:hidden"
					data-testid="prereg-cards"
				>
					{#each items as item (item.id)}
						<li class="space-y-2 p-3 text-sm">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<div class="min-w-0"><PreRegNameLink {item} /></div>
								<PreRegStatusBadge {item} />
							</div>
							<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-slate-700">
								<dt class="text-slate-500">ครอบครัว</dt>
								<dd class="break-words">{@render household(item)}</dd>
								<dt class="text-slate-500">ศูนย์พักพิง</dt>
								<dd class="break-words"><PreRegShelterCell {item} /></dd>
								<dt class="text-slate-500">ต้นทาง</dt>
								<dd class="break-words">{originLabel(item)}</dd>
								<dt class="text-slate-500">ประเทศ</dt>
								<dd>{item.country ?? '—'}</dd>
								<dt class="text-slate-500">ช่วงอายุ</dt>
								<dd>{AGE_BUCKET_LABELS[item.age_band] ?? item.age_band}</dd>
								<dt class="text-slate-500">ลงทะเบียน</dt>
								<dd class="tabular-nums">{formatWhen(item.registered_at)}</dd>
								<dt class="text-slate-500">แหล่งข้อมูล</dt>
								<dd>{@render sourceBadge(item)}</dd>
							</dl>
						</li>
					{/each}
				</ul>
				<div class="hidden overflow-x-auto rounded-xl border border-slate-200/80 md:block">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>ชื่อ</Table.Head>
								<Table.Head>ครอบครัว</Table.Head>
								<Table.Head>สถานะการเข้าศูนย์</Table.Head>
								<Table.Head>ศูนย์พักพิง</Table.Head>
								<Table.Head>ต้นทาง</Table.Head>
								<Table.Head>ประเทศ</Table.Head>
								<Table.Head>ช่วงอายุ</Table.Head>
								<Table.Head>เวลาลงทะเบียน</Table.Head>
								<Table.Head>แหล่งข้อมูล</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each items as item (item.id)}
								<Table.Row>
									<Table.Cell>
										<PreRegNameLink {item} />
									</Table.Cell>
									<Table.Cell class="text-sm font-medium text-slate-800">
										{@render household(item)}
									</Table.Cell>
									<Table.Cell>
										<PreRegStatusBadge {item} />
									</Table.Cell>
									<Table.Cell>
										<PreRegShelterCell {item} />
									</Table.Cell>
									<Table.Cell class="text-sm text-slate-700">{originLabel(item)}</Table.Cell>
									<Table.Cell class="text-sm text-slate-700">{item.country ?? '—'}</Table.Cell>
									<Table.Cell class="text-sm text-slate-700">
										{AGE_BUCKET_LABELS[item.age_band] ?? item.age_band}
									</Table.Cell>
									<Table.Cell class="text-sm text-slate-700 tabular-nums">
										{formatWhen(item.registered_at)}
									</Table.Cell>
									<Table.Cell class="text-sm text-slate-600">
										{@render sourceBadge(item)}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</div>
	</div>
</StaffPageShell>
