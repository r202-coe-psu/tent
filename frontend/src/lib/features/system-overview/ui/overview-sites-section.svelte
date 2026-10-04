<script lang="ts">
	import { resolve } from '$app/paths';
	import { parseDate } from '@internationalized/date';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { DateRangePicker } from '$lib/components/ui/date-picker';
	import { Label } from '$lib/components/ui/label';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { SITE_KIND_LABELS, type SiteKind } from '$lib/features/shelters/domain/schema';
	import { thailandDateString, type OverviewSiteRow } from '../domain/schemas';

	let {
		sites,
		loading = false,
		movementFrom,
		movementTo,
		onMovementRangeChange
	}: {
		sites: OverviewSiteRow[] | undefined;
		loading?: boolean;
		movementFrom: string; // YYYY-MM-DD
		movementTo: string;
		onMovementRangeChange: (next: { movement_from: string; movement_to: string }) => void;
	} = $props();

	const maxValue = $derived(parseDate(thailandDateString()));

	const STATUS_LABELS: Record<string, string> = {
		standby: 'เตรียมการ',
		active: 'เปิดรับ',
		full_capacity: 'เต็มความจุ',
		closed: 'ปิดศูนย์'
	};

	function formatPct(value: number | null): string {
		return value == null ? '—' : `${value}%`;
	}

	function siteKindLabel(kind: SiteKind): string {
		return SITE_KIND_LABELS[kind] ?? kind;
	}

	function statusLabel(status: string): string {
		return STATUS_LABELS[status] ?? status;
	}
</script>

<Card.Root class="rounded-xl border border-slate-200/80 bg-white shadow-2xs">
	<Card.Header class="space-y-4">
		<div>
			<Card.Title class="text-lg font-bold text-slate-900">ศูนย์ / ไซต์</Card.Title>
			<Card.Description class="text-sm text-slate-500">เรียงตาม คาดการณ์ % จาก API</Card.Description
			>
		</div>
		<div class="flex flex-wrap items-end gap-3">
			<div class="min-w-0 space-y-1.5">
				<Label for="sites-movement-range" class="text-sm font-semibold text-slate-700">
					ช่วงเข้า / ออก
				</Label>
				<DateRangePicker
					id="sites-movement-range"
					ariaLabel="ช่วงวันที่เข้าออก"
					from={movementFrom}
					to={movementTo}
					{maxValue}
					onRangeChange={({ from, to }) => {
						onMovementRangeChange({ movement_from: from, movement_to: to });
					}}
					class="h-9"
				/>
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if loading && !sites}
			<Skeleton class="h-48 w-full rounded-xl" />
		{:else if !sites || sites.length === 0}
			<p class="py-6 text-center text-sm text-slate-500">ไม่พบศูนย์ที่ตรงเงื่อนไข</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-slate-200/80">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>ชื่อ</Table.Head>
							<Table.Head>ประเภท</Table.Head>
							<Table.Head>สถานะ</Table.Head>
							<Table.Head class="text-right">ปัจจุบัน</Table.Head>
							<Table.Head class="text-right">คาดการณ์</Table.Head>
							<Table.Head class="text-right">ปัจจุบัน%</Table.Head>
							<Table.Head class="text-right">คาดการณ์%</Table.Head>
							<Table.Head class="text-right">เข้า</Table.Head>
							<Table.Head class="text-right">ออก</Table.Head>
							<Table.Head>พิกัด</Table.Head>
							<Table.Head></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each sites as site (site.shelter_code)}
							<Table.Row>
								<Table.Cell class="font-medium text-slate-900">
									<div>{site.name}</div>
									<div class="text-xs text-slate-500">{site.shelter_code}</div>
								</Table.Cell>
								<Table.Cell class="text-sm text-slate-700">
									{siteKindLabel(site.site_kind)}
								</Table.Cell>
								<Table.Cell class="text-sm text-slate-700">
									{statusLabel(site.operation_status)}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{site.present}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{site.forecast}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{formatPct(site.present_pct)}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums"
									>{formatPct(site.forecast_pct)}</Table.Cell
								>
								<Table.Cell class="text-right font-semibold text-emerald-700 tabular-nums">
									{site.checkin}
								</Table.Cell>
								<Table.Cell class="text-right font-semibold text-red-700 tabular-nums">
									{site.checkout}
								</Table.Cell>
								<Table.Cell>
									{#if site.has_coords}
										<Badge
											variant="outline"
											class="border-emerald-200 bg-emerald-50 text-emerald-900"
										>
											มีพิกัด
										</Badge>
									{:else}
										<Badge variant="outline" class="border-slate-200 bg-slate-50 text-slate-600">
											ไม่มี
										</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<a
										href={resolve(site.dashboard_href as '/back-office/evacuee-management')}
										class="text-sm font-semibold text-[#0284C7] hover:underline"
									>
										แดชบอร์ด
									</a>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
