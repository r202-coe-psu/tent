<script module lang="ts">
	export type AttendanceTileFilter = 'active' | 'expected' | 'completed' | '';
</script>

<script lang="ts">
	/**
	 * "สรุปยอดปฏิบัติงานสดประจำวันนี้ (Today's Live Attendance Bar)" — Roster tab
	 * (Tab 2), owner-approved mockup 2026-08-29.
	 *
	 * Purely presentational: `activeOnSite`/`expectedToday`/`completed` are
	 * handed in from `domain/hub-metrics.ts#computeHubMetrics`'s `checkedInNow` /
	 * `assigned` / `completed` fields via the tab's single `useHubMetrics()` call
	 * — this component must never recompute them itself (CR-094 FR-VOL-08.2 /
	 * AC-094-09, same rule `volunteer-hub-header.svelte` follows).
	 *
	 * Tiles double as a click-to-filter toggle (`selected`, mirrors
	 * `volunteer-stat-pills.svelte`'s pattern): clicking one narrows the roster
	 * list below to that status group, clicking the active tile again clears it.
	 */
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import Clock from '@lucide/svelte/icons/clock';
	import LogOut from '@lucide/svelte/icons/log-out';

	let {
		activeOnSite,
		expectedToday,
		completed,
		isPending,
		selected = $bindable<AttendanceTileFilter>('')
	}: {
		activeOnSite: number;
		expectedToday: number;
		completed: number;
		isPending: boolean;
		selected?: AttendanceTileFilter;
	} = $props();

	type TileKey = Exclude<AttendanceTileFilter, ''>;

	function toggleTile(key: TileKey) {
		selected = selected === key ? '' : key;
	}

	const total = $derived(activeOnSite + expectedToday + completed);

	interface Tile {
		key: TileKey;
		label: string;
		sub: string;
		value: number;
		icon: typeof UserCheck;
		cardClass: string;
		iconClass: string;
		valueClass: string;
	}

	const tiles: Tile[] = $derived([
		{
			key: 'active',
			label: 'ปฏิบัติหน้าที่อยู่ขณะนี้',
			sub: 'Active On-site (สแกนเข้างานแล้ว)',
			value: activeOnSite,
			icon: UserCheck,
			cardClass: 'border-emerald-200 bg-emerald-50/40',
			iconClass: 'bg-emerald-100 text-emerald-700',
			valueClass: 'text-emerald-700'
		},
		{
			key: 'expected',
			label: 'รอมารายงานตัวเข้ากะ',
			sub: 'Expected Today (มีตารางกะวันนี้)',
			value: expectedToday,
			icon: Clock,
			cardClass: 'border-amber-200 bg-amber-50/40',
			iconClass: 'bg-amber-100 text-amber-700',
			valueClass: 'text-amber-700'
		},
		{
			key: 'completed',
			label: 'เสร็จสิ้นภารกิจ/เช็คเอาต์แล้ว',
			sub: 'Completed (เช็คเอาต์ออกงานวันนี้)',
			value: completed,
			icon: LogOut,
			cardClass: 'border-border bg-muted/30',
			iconClass: 'bg-slate-200 text-slate-700',
			valueClass: 'text-foreground'
		}
	]);
</script>

<div class="rounded-2xl border border-border bg-card p-4">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
		<div>
			<p class="text-sm font-bold text-foreground">
				สรุปยอดปฏิบัติงานสดประจำวันนี้ (Today's Live Attendance Bar)
			</p>
			<p class="text-xs text-muted-foreground">
				สถานะการเข้ากะและการปฏิบัติหน้าที่ของอาสาสมัคร ณ ศูนย์นี้
			</p>
		</div>
		{#if isPending}
			<Skeleton class="h-6 w-24 rounded-full" />
		{:else}
			<span
				class="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-bold text-foreground"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
				ยอดรวมวันนี้: {total} คน
			</span>
		{/if}
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		{#each tiles as tile (tile.key)}
			{@const Icon = tile.icon}
			{@const isSelected = selected === tile.key}
			<button
				type="button"
				aria-pressed={isSelected}
				disabled={isPending}
				onclick={() => toggleTile(tile.key)}
				class="w-full rounded-xl border p-4 text-left transition-shadow {tile.cardClass} {isSelected
					? 'ring-2 ring-primary-dark ring-offset-1'
					: 'hover:shadow-sm'} disabled:cursor-not-allowed disabled:opacity-60"
			>
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<p class="text-xs font-bold text-foreground">{tile.label}</p>
						<p class="text-[11px] text-muted-foreground">{tile.sub}</p>
					</div>
					<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl {tile.iconClass}">
						<Icon class="h-4.5 w-4.5" />
					</div>
				</div>
				{#if isPending}
					<Skeleton class="mt-3 h-8 w-16" />
				{:else}
					<p class="mt-2 flex items-baseline gap-1">
						<span class="text-2xl font-bold tabular-nums {tile.valueClass}">{tile.value}</span>
						<span class="text-xs text-muted-foreground">คน</span>
					</p>
				{/if}
			</button>
		{/each}
	</div>
</div>
