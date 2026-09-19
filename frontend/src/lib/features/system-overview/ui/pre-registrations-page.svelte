<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { AGE_BUCKET_LABELS } from '$lib/features/dashboard';
	import {
		overviewFiltersSchema,
		getPreRegStatusInfo,
		type OverviewFilters,
		type PreRegistrationListItem
	} from '../domain';
	import { usePreRegistrations } from '../application/queries';
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
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return value;
		return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
	}

	function originLabel(item: PreRegistrationListItem): string {
		return [item.province, item.district, item.subdistrict].filter(Boolean).join(' / ') || '—';
	}
</script>

<div class="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold tracking-tight text-[#0A2647] sm:text-3xl">ลงทะเบียนล่วงหน้า</h1>
		<p class="text-base text-slate-600">
			ตรวจสอบผู้ลงทะเบียนล่วงหน้าทั้งหมด สถานะการเข้าศูนย์ และศูนย์พักพิงปลายทาง
		</p>
	</header>

	<OverviewFilterBar {filters} onChange={onFiltersChange} showHouseholdFilter={true} />

	{#if listQuery.isError}
		<Alert variant="destructive">
			<AlertCircle class="h-4 w-4" />
			<AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
			<AlertDescription>ไม่สามารถโหลดรายการลงทะเบียนล่วงหน้าได้</AlertDescription>
		</Alert>
	{/if}

	<Card.Root class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
		<Card.Header class="flex flex-row items-center justify-between gap-3 space-y-0">
			<div>
				<Card.Title class="text-lg font-bold text-slate-900">รายการทั้งหมด</Card.Title>
				<Card.Description class="text-sm text-slate-500">
					{#if listQuery.isPending && items.length === 0}
						กำลังโหลด...
					{:else}
						แสดง {pageStart.toLocaleString('th-TH')}–{pageEnd.toLocaleString('th-TH')} จาก
						{total.toLocaleString('th-TH')}
					{/if}
				</Card.Description>
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
		</Card.Header>
		<Card.Content>
			{#if listQuery.isPending && items.length === 0}
				<Skeleton class="h-48 w-full rounded-xl" />
			{:else if items.length === 0}
				<p class="py-8 text-center text-sm text-slate-500">ไม่พบรายการ</p>
			{:else}
				<div class="overflow-x-auto rounded-xl border border-slate-200/80">
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
										<a
											href={resolve(item.profile_href as '/system-management/pre-registrations')}
											class="font-medium text-[#0284C7] hover:underline"
										>
											{item.display_name}
										</a>
									</Table.Cell>
									<Table.Cell class="text-sm font-medium text-slate-800">
										{#if item.household_name}
											<span title={item.household_id ?? undefined}>{item.household_name}</span>
										{:else if item.household_id}
											<span class="font-mono text-xs text-slate-500">{item.household_id}</span>
										{:else}
											<span class="text-slate-400">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell>
										{@const status = getPreRegStatusInfo(
											item.stay_status,
											item.queue_status,
											!!item.shelter_code
										)}
										<span
											class={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${status.className}`}
											title={status.description}
										>
											<span class={`size-1.5 rounded-full ${status.dotColor}`}></span>
											{status.label}
										</span>
									</Table.Cell>
									<Table.Cell>
										{#if item.shelter_name}
											<div class="flex flex-col">
												<span class="text-sm font-medium text-slate-900">{item.shelter_name}</span>
												{#if item.shelter_code}
													<span class="font-mono text-xs text-slate-500">[{item.shelter_code}]</span
													>
												{/if}
											</div>
										{:else if item.shelter_code}
											<span class="font-mono text-sm font-medium text-slate-900"
												>[{item.shelter_code}]</span
											>
										{:else}
											<span class="text-sm text-slate-400">ยังไม่ผูกศูนย์</span>
										{/if}
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
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
