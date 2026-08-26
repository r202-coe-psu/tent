<script lang="ts">
	/**
	 * Smart Volunteer Control Hub header (CR-094 FR-VOL-08.2/08.3/08.7).
	 *
	 * Renders the 5 live counters straight from `useHubMetrics()` — this
	 * component must never recompute a counter itself (AC-094-09). The shelter
	 * scope shown here is the same `shelterStore.selectedShelterCode` the
	 * `(protected)/back-office/+layout.svelte` header picker already writes to;
	 * this header only reads it, it does not add a second picker.
	 *
	 * Deliberately absent (CR-094 FR-VOL-08.7 — mockup-only artifacts, not to be
	 * built): the "LOCAL OFFLINE MODE" banner, the RBAC demo-mode switch, and a
	 * Debug View button. This app is remote-first with no offline write path.
	 */
	import UserCheck from '@lucide/svelte/icons/user-check';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import LogIn from '@lucide/svelte/icons/log-in';
	import Clock from '@lucide/svelte/icons/clock';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Building from '@lucide/svelte/icons/building';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useHubMetrics } from '../application/queries';

	const hubMetrics = useHubMetrics();

	type Tile = {
		key: string;
		label: string;
		value: number | undefined;
		icon: typeof UserCheck;
		accent: string;
	};

	const tiles = $derived.by<Tile[]>(() => {
		const m = hubMetrics.data;
		return [
			{
				key: 'ready',
				label: 'พร้อมปฏิบัติงาน',
				value: m?.ready,
				icon: UserCheck,
				accent: 'text-emerald-600'
			},
			{
				key: 'assigned',
				label: 'รับกะแล้ว',
				value: m?.assigned,
				icon: ClipboardList,
				accent: 'text-blue-600'
			},
			{
				key: 'checkedInNow',
				label: 'เช็คอินอยู่ตอนนี้',
				value: m?.checkedInNow,
				icon: LogIn,
				accent: 'text-primary'
			},
			{
				key: 'pendingApproval',
				label: 'รออนุมัติ',
				value: m?.pendingApproval,
				icon: Clock,
				accent: 'text-amber-600'
			},
			{
				key: 'pendingIdentity',
				label: 'รอยืนยันตัวตน',
				value: m?.pendingIdentity,
				icon: ShieldAlert,
				accent: 'text-destructive'
			}
		];
	});
</script>

<Card.Root class="border-0 shadow-sm">
	<Card.Content class="flex flex-wrap items-start justify-between gap-4 pt-4">
		<div>
			<h2 class="text-base font-bold">Smart Volunteer Control Hub</h2>
			<p class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
				<Building class="h-3.5 w-3.5" />
				ศูนย์ปัจจุบัน: {shelterStore.selectedShelterCode ?? '—'}
			</p>
		</div>

		{#if hubMetrics.isError}
			<p class="text-xs font-medium text-destructive">
				โหลดตัวนับไม่สำเร็จ: {hubMetrics.error instanceof Error
					? hubMetrics.error.message
					: 'เกิดข้อผิดพลาด'}
			</p>
		{/if}

		<div class="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:w-auto lg:grid-cols-5">
			{#each tiles as tile (tile.key)}
				{@const Icon = tile.icon}
				<div class="rounded-xl bg-muted/40 px-4 py-3">
					<div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<Icon class="h-3.5 w-3.5 {tile.accent}" />
						{tile.label}
					</div>
					{#if hubMetrics.isPending}
						<Skeleton class="mt-1.5 h-6 w-10" />
					{:else}
						<p class="mt-0.5 text-xl font-bold {tile.accent}">
							{(tile.value ?? 0).toLocaleString()}
						</p>
					{/if}
				</div>
			{/each}
		</div>
	</Card.Content>
</Card.Root>
