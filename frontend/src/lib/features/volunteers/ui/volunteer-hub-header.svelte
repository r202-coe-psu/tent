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
	 * identity block on the left, one hairline-divided counter strip on the
	 * right whose last cell is the shelter scope. Exactly two containers, so
	 * the strip stays flat rather than card-inside-card.
	 *
	 * Deliberately absent (CR-094 FR-VOL-08.7 — mockup-only artifacts, not to be
	 * built): the "LOCAL OFFLINE MODE" banner, the RBAC demo-mode switch, and a
	 * Debug View button. This app is remote-first with no offline write path.
	 */
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter } from '$lib/features/shelters';
	import { useHubMetrics } from '../application/queries';

	const hubMetrics = useHubMetrics();

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterQuery = useShelter(() => shelterCode);
	const shelterLabel = $derived(shelterQuery.data?.name ?? shelterCode ?? '—');
	/** Hover copy: full name is never truncated here, and the code is useful next to it. */
	const shelterTooltip = $derived(
		shelterQuery.data?.name ? `${shelterCode} — ${shelterQuery.data.name}` : shelterLabel
	);

	type Tile = {
		key: string;
		label: string;
		value: number | undefined;
		/** Thai counting unit shown after the number, as in the approved mockup. */
		unit: string;
		valueClass: string;
		labelClass: string;
		/** Small leading dot — reserved for the one counter that needs action. */
		dot?: boolean;
	};

	const tiles = $derived.by<Tile[]>(() => {
		const m = hubMetrics.data;
		return [
			{
				key: 'ready',
				label: 'พร้อมปฏิบัติงาน',
				value: m?.ready,
				unit: 'คน',
				valueClass: 'text-white',
				labelClass: 'text-white/55'
			},
			{
				key: 'assigned',
				label: 'รับกะแล้ว',
				value: m?.assigned,
				unit: 'คน',
				valueClass: 'text-amber-300',
				labelClass: 'text-amber-200/70'
			},
			{
				key: 'checkedInNow',
				label: 'เช็คอินอยู่ตอนนี้',
				value: m?.checkedInNow,
				unit: 'คน',
				valueClass: 'text-emerald-300',
				labelClass: 'text-emerald-200/70'
			},
			{
				key: 'pendingApproval',
				label: 'รออนุมัติ',
				value: m?.pendingApproval,
				unit: 'ราย',
				valueClass: 'text-yellow-300',
				labelClass: 'text-yellow-200/70',
				dot: true
			},
			{
				key: 'pendingIdentity',
				label: 'รอยืนยันตัวตน',
				value: m?.pendingIdentity,
				unit: 'คน',
				valueClass: 'text-sky-300',
				labelClass: 'text-sky-200/70'
			}
		];
	});
</script>

<section
	class="relative overflow-hidden rounded-3xl bg-primary-dark px-5 py-5 text-white sm:px-7 sm:py-6"
>
	<!-- Single ambient wash so the slab is not a flat block; no glow stacking. -->
	<div
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(255,255,255,0.09),transparent_55%)]"
	></div>

	<div
		class="relative flex flex-col gap-5 2xl:flex-row 2xl:items-center 2xl:justify-between 2xl:gap-8"
	>
		<div class="flex items-start gap-3.5 sm:gap-4">
			<div
				class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/8 ring-1 ring-white/10 sm:h-14 sm:w-14"
			>
				<HeartHandshake class="h-6 w-6 text-sky-300 sm:h-7 sm:w-7" />
			</div>
			<div class="min-w-0">
				<h2 class="text-lg font-bold tracking-tight sm:text-xl">Smart Volunteer Control Hub</h2>
				<p class="mt-1 text-xs leading-relaxed text-white/55 sm:text-sm">
					ศูนย์ปฏิบัติการจิตอาสา: คำนวณด้วยฟังก์ชันมาตรฐานเดียว (Single Source of Truth)
				</p>
				{#if hubMetrics.isError}
					<p class="mt-2 text-xs font-medium text-rose-300">
						โหลดตัวนับไม่สำเร็จ: {hubMetrics.error instanceof Error
							? hubMetrics.error.message
							: 'เกิดข้อผิดพลาด'}
					</p>
				{/if}
			</div>
		</div>

		<!-- `gap-px` over a lighter container fill draws the hairline dividers, so
		     they survive every wrap point instead of only the inline row. -->
		<div
			class="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-3 2xl:grid-cols-6"
		>
			{#each tiles as tile (tile.key)}
				<div class="bg-white/5 px-4 py-2.5 sm:px-5 sm:py-3">
					<p class="flex items-center gap-1.5 text-[11px] font-medium sm:text-xs {tile.labelClass}">
						{#if tile.dot}
							<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-current"></span>
						{/if}
						{tile.label}
					</p>
					{#if hubMetrics.isPending}
						<Skeleton class="mt-1.5 h-6 w-12 bg-white/15" />
					{:else}
						<p class="mt-0.5 flex items-baseline gap-1">
							<span class="text-xl font-bold tabular-nums sm:text-2xl {tile.valueClass}">
								{(tile.value ?? 0).toLocaleString()}
							</span>
							<span class="text-[11px] font-medium text-white/45">{tile.unit}</span>
						</p>
					{/if}
				</div>
			{/each}

			<div class="col-span-2 bg-white/5 px-4 py-2.5 sm:col-span-1 sm:px-5 sm:py-3">
				<p class="text-[11px] font-medium text-white/55 sm:text-xs">ศูนย์ที่เลือก</p>
				<Tooltip.Provider>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<p
									{...props}
									class="mt-1 max-w-full cursor-default truncate text-left text-sm font-bold text-white sm:text-base"
								>
									{shelterLabel}
								</p>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>{shelterTooltip}</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			</div>
		</div>
	</div>
</section>
