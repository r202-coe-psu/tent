<script lang="ts">
	import Timer from '@lucide/svelte/icons/timer';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import {
		useDashboardStationTimes,
		stationAverageSec,
		formatServiceDuration,
		type StationTimeRow
	} from '$lib/features/dashboard';
	import { countStationQueues, useEvacuees, useScreenings } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { stationVar } from '$lib/tokens/colors';
	import { formatThaiShortDate } from '$lib/utils/date';
	import DashboardServiceTimeChart from './dashboard-service-time-chart.svelte';
	import DashboardStationActorRank from './dashboard-station-actor-rank.svelte';

	let {
		shelterCode,
		params
	}: {
		shelterCode: string;
		/** The `from` / `to` of the dashboard range shared with the registration chart (CR-170). */
		params: { from?: string; to?: string };
	} = $props();

	// Station colour families (`baseStation`), the same ones the onsite station pages use, so a
	// card reads as "its" station. Class strings are literal so Tailwind keeps them.
	const STATIONS = [
		{
			station: 1,
			label: 'Station 1',
			subtitle: 'รายงานตัว / ลงทะเบียน',
			color: stationVar(1),
			card: 'border-station-1-border',
			title: 'text-station-1-text',
			stat: 'bg-station-1-subtle'
		},
		{
			station: 2,
			label: 'Station 2',
			subtitle: 'คัดกรองสุขภาพ',
			color: stationVar(2),
			card: 'border-station-2-border',
			title: 'text-station-2-text',
			stat: 'bg-station-2-subtle'
		},
		{
			station: 3,
			label: 'Station 3',
			subtitle: 'จัดโซนที่พัก',
			color: stationVar(3),
			card: 'border-station-3-border',
			title: 'text-station-3-text',
			stat: 'bg-station-3-subtle'
		}
	] as const;

	const CHANNEL_LABELS = { staff: 'เจ้าหน้าที่', kiosk: 'ตู้ kiosk' } as const;

	const timesQuery = useDashboardStationTimes(
		() => shelterCode,
		() => params.from,
		() => params.to
	);

	// Queue now (FR-STL-23): derived from existing evacuee / screening state, never a new field.
	const shelterQuery = useShelter(() => shelterCode);
	const evacueesQuery = useEvacuees();
	const screeningsQuery = useScreenings();
	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const queues = $derived(
		evacueesQuery.data && screeningsQuery.data
			? countStationQueues(
					evacueesQuery.data,
					new Set(screeningsQuery.data.map((s) => s.evacuee_id)),
					{ enableMedicalScreening: enableMedical }
				)
			: null
	);

	/** Station 2/3 queue; Station 1 has no on-site queue status and shows its own two counts. */
	function queueOf(station: number): number | null {
		if (!queues) return null;
		if (station === 2) return queues.station2;
		return queues.station3;
	}

	const cards = $derived.by(() => {
		const rows: readonly StationTimeRow[] = timesQuery.data?.stations ?? [];
		const actors = timesQuery.data?.actors ?? [];
		return STATIONS.map((meta) => {
			const own = rows.filter((r) => r.station === meta.station);
			return {
				...meta,
				avgSec: stationAverageSec(rows, meta.station),
				visits: own.reduce((sum, r) => sum + r.visits, 0),
				openVisits: own.reduce((sum, r) => sum + r.open_visits, 0),
				queue: queueOf(meta.station),
				channels: own,
				// The BFF already ranks fastest first; filtering keeps that order.
				actors: actors.filter((a) => a.station === meta.station)
			};
		});
	});

	const stationBars = $derived(
		cards.map((card) => ({ label: card.label, seconds: card.avgSec, color: card.color }))
	);
	const stationOneChannelBars = $derived(
		(cards[0]?.channels ?? []).map((row) => ({
			label: CHANNEL_LABELS[row.channel],
			seconds: row.avg_duration_sec,
			color: stationVar(1)
		}))
	);
</script>

<div class="min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
	<div class="space-y-1">
		<div class="flex items-center gap-2">
			<Timer class="h-4 w-4 text-primary" />
			<h3 class="leading-none font-semibold tracking-tight">เวลาให้บริการแต่ละ Station</h3>
		</div>
		<p class="text-sm text-muted-foreground">
			{#if timesQuery.data}
				<span class="tabular-nums">
					{formatThaiShortDate(timesQuery.data.range.from)} – {formatThaiShortDate(
						timesQuery.data.range.to
					)}
				</span>
				·
			{/if}
			ใช้ช่วงวันที่เดียวกับสถิติการลงทะเบียน นับตามวันที่เริ่มให้บริการ
		</p>
	</div>

	{#if timesQuery.isPending}
		<Skeleton class="h-56 w-full" />
		<div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
			<Skeleton class="h-40 w-full" />
			<Skeleton class="h-40 w-full" />
			<Skeleton class="h-40 w-full" />
		</div>
	{:else if timesQuery.isError}
		<Alert variant="destructive">
			<AlertCircle class="h-4 w-4" />
			<AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
			<AlertDescription>
				ไม่สามารถโหลดเวลาให้บริการของแต่ละ Station ได้ กรุณาลองใหม่อีกครั้ง
			</AlertDescription>
		</Alert>
	{:else if timesQuery.data}
		<div
			class={['space-y-4 transition-opacity', timesQuery.isPlaceholderData && 'opacity-60']}
			aria-busy={timesQuery.isPlaceholderData}
		>
			<div>
				<h4 class="mb-2 text-sm font-semibold text-foreground">เวลาให้บริการเฉลี่ยต่อ Station</h4>
				<DashboardServiceTimeChart items={stationBars} />
			</div>

			<div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
				{#each cards as card (card.station)}
					<div
						class={['min-w-0 rounded-xl border bg-white p-4 shadow-2xs', card.card]}
						data-testid="station-card"
					>
						<div class="mb-3">
							<p class={['font-semibold', card.title]}>{card.label}</p>
							<p class="text-xs text-muted-foreground">{card.subtitle}</p>
						</div>
						<p class="text-2xl font-bold tabular-nums">{formatServiceDuration(card.avgSec)}</p>
						<p class="mb-3 text-xs text-muted-foreground">เวลาให้บริการเฉลี่ย</p>
						<dl
							class={['grid gap-2 text-center', card.station === 1 ? 'grid-cols-2' : 'grid-cols-3']}
						>
							<div class={['rounded-md px-2 py-1.5', card.stat]}>
								<dt class="text-2xs text-muted-foreground">ให้บริการแล้ว</dt>
								<dd class="font-semibold tabular-nums">{card.visits}</dd>
							</div>
							<div class={['rounded-md px-2 py-1.5', card.stat]}>
								<dt class="text-2xs text-muted-foreground">กำลังให้บริการ</dt>
								<dd class="font-semibold tabular-nums">{card.openVisits}</dd>
							</div>
							{#if card.station === 1}
								<div class={['rounded-md px-2 py-1.5', card.stat]}>
									<dt class="text-2xs text-muted-foreground">ลงทะเบียนล่วงหน้า</dt>
									<dd class="font-semibold tabular-nums">
										{queues?.station1.preRegistered ?? '—'}
									</dd>
								</div>
								<div class={['rounded-md px-2 py-1.5', card.stat]}>
									<dt class="text-2xs text-muted-foreground">ลงทะเบียนที่ตู้</dt>
									<dd class="font-semibold tabular-nums">
										{queues?.station1.kioskRegistered ?? '—'}
									</dd>
								</div>
							{:else}
								<div class={['rounded-md px-2 py-1.5', card.stat]}>
									<dt class="text-2xs text-muted-foreground">รอคิวตอนนี้</dt>
									<dd class="font-semibold tabular-nums">{card.queue ?? '—'}</dd>
								</div>
							{/if}
						</dl>
						{#if card.station === 1}
							<div class="mt-4 border-t pt-3">
								<h4 class="mb-1 text-xs font-semibold text-foreground">
									เจ้าหน้าที่ เทียบกับ ตู้ kiosk
								</h4>
								<DashboardServiceTimeChart items={stationOneChannelBars} heightClass="h-40" />
								<p class="mt-1 text-2xs text-muted-foreground">
									{#each card.channels as row, index (row.channel)}
										{#if index > 0}
											·
										{/if}
										{CHANNEL_LABELS[row.channel]}
										{row.visits} ราย
									{/each}
								</p>
							</div>
						{:else if card.station === 2 && !enableMedical}
							<p class="mt-3 text-2xs text-muted-foreground">
								ศูนย์นี้ไม่ได้เปิดใช้การคัดกรองสุขภาพ
							</p>
						{/if}
						<DashboardStationActorRank actors={card.actors} rowClass={card.stat} />
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
