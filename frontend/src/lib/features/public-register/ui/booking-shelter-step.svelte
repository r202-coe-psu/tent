<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { PublicShelterCardModel } from '$lib/features/public-portal';
	import { getBookingStore } from '../application/booking-store.svelte';

	interface Props {
		shelters: PublicShelterCardModel[];
	}

	const { shelters }: Props = $props();
	const booking = getBookingStore();

	let query = $state('');

	// `CLOSED` is the only hard block (FR-72) — a full shelter stays bookable and
	// warns instead, matching the warning-only occupancy guardrail of T-51.
	const bookable = $derived(shelters.filter((s) => s.status !== 'CLOSED'));

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return bookable;
		return bookable.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.address.toLowerCase().includes(q) ||
				s.code.toLowerCase().includes(q)
		);
	});

	const selected = $derived(shelters.find((s) => s.code === booking.shelterCode) ?? null);

	function choose(shelter: PublicShelterCardModel) {
		booking.selectShelter(shelter);
	}
</script>

<div class="space-y-4 rounded-2xl border border-black/[0.04] bg-card p-5 shadow-sm sm:p-6">
	<div>
		<h2 class="text-lg font-bold text-foreground">เลือกศูนย์พักพิงที่ต้องการเข้าพัก</h2>
		<p class="mt-1 text-sm text-muted-foreground">
			ระบบจะกันที่ให้ทันทีเมื่อจองสำเร็จ ท่านสามารถนำ QR ที่ได้ไปยืนยันตัวตนที่ประตูศูนย์
		</p>
	</div>

	<div class="relative">
		<Search
			class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			bind:value={query}
			placeholder="ค้นหาชื่อศูนย์ ตำบล อำเภอ หรือจังหวัด"
			class="pl-9"
			aria-label="ค้นหาศูนย์พักพิง"
		/>
	</div>

	{#if visible.length === 0}
		<p class="rounded-xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">
			{shelters.length === 0
				? 'ยังไม่มีข้อมูลศูนย์พักพิงในขณะนี้ กรุณาลองใหม่ภายหลัง'
				: 'ไม่พบศูนย์พักพิงที่ตรงกับคำค้นหา'}
		</p>
	{:else}
		<ul class="grid max-h-[26rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
			{#each visible as shelter (shelter.code)}
				{@const isSelected = booking.shelterCode === shelter.code}
				<li>
					<button
						type="button"
						onclick={() => choose(shelter)}
						aria-pressed={isSelected}
						class="w-full cursor-pointer rounded-xl border p-4 text-left transition-colors
							{isSelected
							? 'border-primary bg-primary-muted'
							: 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'}"
					>
						<div class="flex items-start justify-between gap-2">
							<span class="text-sm font-bold text-foreground">{shelter.name}</span>
							{#if shelter.status === 'FULL'}
								<span
									class="shrink-0 rounded-full bg-danger-muted px-2 py-0.5 text-[10px] font-bold text-danger"
								>
									เต็ม
								</span>
							{/if}
						</div>
						<p class="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
							<MapPin class="mt-0.5 h-3 w-3 shrink-0" />
							<span>{shelter.address}</span>
						</p>
						<p class="mt-2 text-[11px] text-muted-foreground">รหัสศูนย์ {shelter.code}</p>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if selected?.status === 'FULL'}
		<p
			class="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-muted/40 p-3 text-xs text-danger"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>
				ศูนย์นี้มีผู้เข้าพักเต็มความจุแล้ว ท่านยังจองได้
				แต่เจ้าหน้าที่อาจจัดสรรพื้นที่ให้ใหม่เมื่อไปถึง
			</span>
		</p>
	{/if}

	<div class="flex justify-end pt-1">
		<Button type="button" disabled={!booking.shelterCode} onclick={() => booking.goTo('person', 2)}>
			ถัดไป
		</Button>
	</div>
</div>
