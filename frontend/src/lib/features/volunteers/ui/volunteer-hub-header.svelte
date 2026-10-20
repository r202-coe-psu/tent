<script lang="ts">
	/**
	 * Smart Volunteer Control Hub header (CR-094 FR-VOL-08.2/08.3/08.7).
	 *
	 * Renders the 5 live counters straight from `useHubMetrics()` — this
	 * component must never recompute a counter itself (AC-094-09). The shelter
	 * in scope is the back-office header picker's; this header does not repeat it.
	 *
	 * Visual: laid out like the other back-office pages (คลังของศูนย์, หน้าสรุปมื้อ) — a plain
	 * page header (navy title, slate description) and the counters as separate KPI cards in
	 * the evacuee dashboard's card style.
	 * A queue someone has to work through takes the warning treatment (amber-50 fill, amber
	 * border) while it is not empty.
	 *
	 * Deliberately absent (CR-094 FR-VOL-08.7 — mockup-only artifacts, not to be
	 * built): the "LOCAL OFFLINE MODE" banner, the RBAC demo-mode switch, and a
	 * Debug View button. This app is remote-first with no offline write path.
	 */
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import IdCard from '@lucide/svelte/icons/id-card';
	import LogIn from '@lucide/svelte/icons/log-in';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { useHubMetrics } from '../application/queries';

	const hubMetrics = useHubMetrics();

	type Tile = {
		key: string;
		label: string;
		value: number | undefined;
		/** Thai counting unit shown after the number, as in the approved mockup. */
		unit: string;
		/** Icon in the card's corner, coloured by meaning — as on the other back-office KPI cards. */
		icon: typeof UsersRound;
		iconClass: string;
		/** A queue someone has to work through: tinted while it is not empty. */
		actionable?: boolean;
	};

	const tiles = $derived.by<Tile[]>(() => {
		const m = hubMetrics.data;
		// Shift flow left to right — in the pool → shift request awaiting confirmation → holds a
		// shift today → checked in — with the identity-check queue last.
		return [
			{
				key: 'ready',
				label: 'พร้อมปฏิบัติงาน',
				value: m?.ready,
				unit: 'คน',
				icon: UsersRound,
				iconClass: 'text-blue-500'
			},
			{
				key: 'pendingApproval',
				label: 'รอยืนยันเข้ากะ',
				value: m?.pendingApproval,
				unit: 'ราย',
				icon: Hourglass,
				iconClass: 'text-amber-500',
				actionable: true
			},
			{
				key: 'assigned',
				label: 'รับกะแล้ว',
				value: m?.assigned,
				unit: 'คน',
				icon: CalendarCheck,
				iconClass: 'text-sky-500'
			},
			{
				key: 'checkedInNow',
				label: 'กำลังปฏิบัติงาน',
				value: m?.checkedInNow,
				unit: 'คน',
				icon: LogIn,
				iconClass: 'text-green-500'
			},
			{
				key: 'pendingIdentity',
				label: 'รอตรวจสอบและอนุมัติ',
				value: m?.pendingIdentity,
				unit: 'คน',
				icon: IdCard,
				iconClass: 'text-amber-500',
				actionable: true
			}
		];
	});
</script>

<!--
	Laid out by its own width (container query), not the viewport: the back-office sidebar
	leaves this block far narrower than the screen.
-->
<div class="@container space-y-5">
	<header class="flex flex-col gap-3 @2xl:flex-row @2xl:items-end @2xl:justify-between @2xl:gap-8">
		<div class="min-w-0 space-y-1">
			<h2 class="text-2xl font-bold tracking-tight text-[#0A2647] sm:text-3xl">จัดการอาสาสมัคร</h2>
			<p class="text-base text-slate-600">
				ศูนย์ปฏิบัติการจิตอาสา: คำนวณด้วยฟังก์ชันมาตรฐานเดียว (Single Source of Truth)
			</p>
			{#if hubMetrics.isError}
				<p class="text-sm font-medium text-red-700" role="alert">
					โหลดตัวนับไม่สำเร็จ: {hubMetrics.error instanceof Error
						? hubMetrics.error.message
						: 'เกิดข้อผิดพลาด'}
				</p>
			{/if}
		</div>
	</header>

	<!-- Narrow: one card per row, icon and label left and number right, so Thai labels never
	     break mid-word in a half-width card. -->
	<dl class="grid grid-cols-1 gap-2 @md:grid-cols-2 @md:gap-3 @3xl:grid-cols-5 @3xl:gap-4">
		{#each tiles as tile, index (tile.key)}
			{@const needsAction = tile.actionable && (tile.value ?? 0) > 0}
			<div
				class={[
					'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-sm',
					'@md:flex-col @md:items-stretch @md:p-4 @3xl:p-5',
					needsAction ? 'border-amber-200 bg-amber-50' : 'border-border bg-card',
					index === tiles.length - 1 && '@md:col-span-2 @3xl:col-span-1'
				]}
			>
				<div
					class="flex min-w-0 flex-row-reverse items-center justify-end gap-2 @md:flex-row @md:items-start @md:justify-between"
				>
					<dt
						class={[
							'text-sm leading-snug font-medium',
							needsAction ? 'text-amber-900' : 'text-slate-700'
						]}
					>
						{tile.label}
					</dt>
					<tile.icon class="h-4 w-4 shrink-0 {tile.iconClass}" aria-hidden="true" />
				</div>
				<dd class="flex shrink-0 items-baseline gap-1">
					{#if hubMetrics.isPending}
						<Skeleton class="h-7 w-12" />
					{:else}
						<span
							class={[
								'text-2xl leading-none font-bold tabular-nums',
								needsAction ? 'text-amber-900' : 'text-slate-900'
							]}
						>
							{(tile.value ?? 0).toLocaleString()}
						</span>
						<span class="text-xs font-medium text-slate-500">{tile.unit}</span>
					{/if}
				</dd>
			</div>
		{/each}
	</dl>
</div>
