<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { Household } from '../domain/people';
	import { zoneLabel } from '../domain/people';

	let {
		household,
		onOpenAddressModal
	}: {
		household: Household;
		onOpenAddressModal: () => void;
	} = $props();
</script>

<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
	<div class="flex items-center justify-between border-b border-border pb-3">
		<h3 class="flex items-center gap-2 text-base font-black text-slate-800 dark:text-slate-200">
			<MapPin class="size-5 text-primary" />
			ข้อมูลที่อยู่และพิกัดศูนย์พักพิง
		</h3>
		<Button variant="outline" size="sm" onclick={onOpenAddressModal}>
			<Pencil class="mr-1.5 size-3.5" /> แก้ไขที่อยู่
		</Button>
	</div>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<div class="space-y-1">
			<Label class="text-xs text-muted-foreground">บ้านเลขที่ / หมู่</Label>
			<p class="text-sm font-semibold text-slate-800">
				{household.address_no || '—'}
				{#if household.village_no}หมู่ที่ {household.village_no}{/if}
			</p>
		</div>
		<div class="space-y-1">
			<Label class="text-xs text-muted-foreground">ตำบล / อำเภอ</Label>
			<p class="text-sm font-semibold text-slate-800">
				{household.subdistrict || '—'} / {household.district || '—'}
			</p>
		</div>
		<div class="space-y-1">
			<Label class="text-xs text-muted-foreground">จังหวัด / รหัสไปรษณีย์</Label>
			<p class="text-sm font-semibold text-slate-800">
				{household.province || '—'}
				{#if household.postal_code}· {household.postal_code}{/if}
			</p>
		</div>
		<div class="space-y-1">
			<Label class="text-xs text-muted-foreground">โซน / ชุมชนในศูนย์</Label>
			<p class="text-sm font-semibold text-slate-800">
				{#if household.municipality_zone}
					เขต {zoneLabel(household.municipality_zone)}
				{:else}
					ไม่ได้ระบุเขต
				{/if}
				{#if household.community}
					(ชุมชน {zoneLabel(household.community)})
				{/if}
			</p>
		</div>
	</div>
</div>
