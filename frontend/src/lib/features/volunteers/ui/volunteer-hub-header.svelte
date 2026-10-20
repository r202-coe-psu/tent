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
	 * Visual: dark `primary-dark` slab (owner-approved mockup 2026-08-27) —
	 * identity block and the shelter-scope chip on top, one hairline-divided
	 * counter strip below. A queue someone has to work through is outlined
	 * in amber while it is not empty.
	 *
	 * Deliberately absent (CR-094 FR-VOL-08.7 — mockup-only artifacts, not to be
	 * built): the "LOCAL OFFLINE MODE" banner, the RBAC demo-mode switch, and a
	 * Debug View button. This app is remote-first with no offline write path.
	 */
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter } from '$lib/features/shelters';
	import { useHubMetrics } from '../application/queries';

	const hubMetrics = useHubMetrics();

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterQuery = useShelter(() => shelterCode);
	const shelterLabel = $derived(shelterQuery.data?.name ?? shelterCode ?? '—');

	type Tile = {
		key: string;
		label: string;
		value: number | undefined;
		/** Thai counting unit shown after the number, as in the approved mockup. */
		unit: string;
		/** Status marker before the label — the colour carries the meaning, the number stays white. */
		dotClass: string;
		/** A queue someone has to work through: tinted while it is not empty. */
		actionable?: boolean;
	};

	const tiles = $derived.by<Tile[]>(() => {
		const m = hubMetrics.data;
		return [
			{
				key: 'ready',
				label: 'พร้อมปฏิบัติงาน',
				value: m?.ready,
				unit: 'คน',
				dotClass: 'bg-white/70'
			},
			{
				key: 'assigned',
				label: 'รับกะแล้ว',
				value: m?.assigned,
				unit: 'คน',
				dotClass: 'bg-sky-300'
			},
			{
				key: 'checkedInNow',
				label: 'เช็คอินอยู่ตอนนี้',
				value: m?.checkedInNow,
				unit: 'คน',
				dotClass: 'bg-emerald-300'
			},
			{
				key: 'pendingIdentity',
				label: 'รอตรวจสอบและอนุมัติ',
				value: m?.pendingIdentity,
				unit: 'คน',
				dotClass: 'bg-amber-300',
				actionable: true
			},
			{
				key: 'pendingApproval',
				label: 'รอยืนยันเข้ากะ',
				value: m?.pendingApproval,
				unit: 'ราย',
				dotClass: 'bg-amber-300',
				actionable: true
			}
		];
	});
</script>

<!--
	Laid out by its own width (container query), not the viewport: in the back office the
	sidebar leaves this slab far narrower than the screen. The shelter scope sits beside
	the title as a labelled chip with its full name — it is context, not a sixth counter,
	and was truncated when it lived in the counter grid.
-->
<section
	class="@container relative overflow-hidden rounded-2xl bg-primary-dark px-5 py-5 text-white sm:px-6 sm:py-6"
>
	<!-- Single ambient wash so the slab is not a flat block; no glow stacking. -->
	<div
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(255,255,255,0.09),transparent_55%)]"
	></div>

	<div class="relative space-y-5">
		<div class="flex flex-col gap-4 @2xl:flex-row @2xl:items-start @2xl:justify-between @2xl:gap-8">
			<div class="flex min-w-0 items-start gap-3.5 sm:gap-4">
				<div
					class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/8 ring-1 ring-white/10 sm:h-14 sm:w-14"
				>
					<HeartHandshake class="h-6 w-6 text-sky-300 sm:h-7 sm:w-7" aria-hidden="true" />
				</div>
				<div class="min-w-0">
					<h2 class="text-lg font-bold tracking-tight text-balance sm:text-xl">
						Smart Volunteer Control Hub
					</h2>
					<p class="mt-1 text-xs leading-relaxed text-white/65 sm:text-sm">
						ศูนย์ปฏิบัติการจิตอาสา: คำนวณด้วยฟังก์ชันมาตรฐานเดียว (Single Source of Truth)
					</p>
					{#if hubMetrics.isError}
						<p class="mt-2 text-xs font-medium text-rose-300" role="alert">
							โหลดตัวนับไม่สำเร็จ: {hubMetrics.error instanceof Error
								? hubMetrics.error.message
								: 'เกิดข้อผิดพลาด'}
						</p>
					{/if}
				</div>
			</div>

			<div
				class="flex items-start gap-2.5 rounded-xl bg-white/8 px-3.5 py-2.5 ring-1 ring-white/10 @2xl:max-w-xs @2xl:shrink-0"
			>
				<MapPin class="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
				<div class="min-w-0">
					<p class="text-xs font-medium text-white/65">ศูนย์ที่เลือก</p>
					<p class="text-sm leading-snug font-bold break-words text-white">{shelterLabel}</p>
				</div>
			</div>
		</div>

		<!-- `gap-px` over a lighter container fill draws the hairline dividers, so
		     they survive every wrap point. Narrow: one row per counter, label left and
		     number right, so Thai labels never break mid-word in a half-width cell. -->
		<dl
			class="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-white/10 @sm:grid-cols-2 @xl:grid-cols-5"
		>
			{#each tiles as tile, index (tile.key)}
				{@const needsAction = tile.actionable && (tile.value ?? 0) > 0}
				<div
					class={[
						'flex items-center justify-between gap-3 bg-white/5 px-4 py-2.5 sm:px-5',
						'@sm:flex-col @sm:items-stretch @sm:gap-2 @sm:py-3.5',
						needsAction && 'ring-1 ring-amber-300/45 ring-inset',
						index === tiles.length - 1 && '@sm:col-span-2 @xl:col-span-1'
					]}
				>
					<dt
						class={[
							'flex items-start gap-1.5 text-xs leading-snug font-medium',
							needsAction ? 'text-amber-100' : 'text-white/70'
						]}
					>
						<span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full {tile.dotClass}"></span>
						{tile.label}
					</dt>
					<dd class="flex shrink-0 items-baseline gap-1">
						{#if hubMetrics.isPending}
							<Skeleton class="h-7 w-12 bg-white/15" />
						{:else}
							<span
								class={[
									'text-xl leading-none font-bold tabular-nums @sm:text-2xl @3xl:text-3xl',
									needsAction ? 'text-amber-200' : 'text-white'
								]}
							>
								{(tile.value ?? 0).toLocaleString()}
							</span>
							<span class="text-xs font-medium text-white/60">{tile.unit}</span>
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	</div>
</section>
