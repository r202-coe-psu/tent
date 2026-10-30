<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { NamedPoint } from '$lib/features/donations';

	/**
	 * "จุดที่ประจำ" — the drop-off point this station receives for (CR-206 FR-MP-18). The
	 * caller renders it only when the shelter has a drop-off point, and remembers the pick
	 * on this device. `value` is the point id; `null` = not picked yet (FR-MP-18a).
	 */
	let {
		points,
		value,
		onchange,
		id = 'receiving-point-select',
		disabled = false
	}: {
		points: readonly NamedPoint[];
		value: string | null;
		onchange: (pointId: string | null) => void;
		id?: string;
		disabled?: boolean;
	} = $props();

	const selected = $derived(points.find((point) => point.id === value) ?? null);
</script>

<div
	class="space-y-1.5 rounded-xl border bg-white p-4 shadow-2xs {selected
		? 'border-slate-200/80'
		: 'border-amber-200'}"
	data-testid="receiving-point"
>
	<Label for={id} class="text-sm font-semibold text-slate-700">
		จุดที่ประจำ <span class="text-red-500">*</span>
	</Label>
	<Select.Root
		type="single"
		value={value ?? ''}
		onValueChange={(next) => onchange(next || null)}
		{disabled}
	>
		<Select.Trigger
			{id}
			data-testid="receiving-point-trigger"
			class="h-12 w-full min-w-0 rounded-md border border-input bg-white px-3 text-base font-semibold shadow-xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none data-[size=default]:h-12"
		>
			<span class="flex min-w-0 items-center gap-2">
				<MapPin class="size-4 shrink-0 text-slate-400" aria-hidden="true" />
				<span class="truncate">{selected ? selected.name : 'เลือกจุดรับบริจาคที่ประจำอยู่'}</span>
			</span>
		</Select.Trigger>
		<Select.Content>
			{#each points as point (point.id)}
				<Select.Item value={point.id} label={point.name} />
			{/each}
		</Select.Content>
	</Select.Root>
	<p class="text-sm text-slate-500">
		{selected
			? 'รับได้เฉพาะรายการของจุดนี้ และรายการที่ส่งที่จุดไหนก็ได้ · เครื่องนี้จำจุดไว้ให้'
			: 'ดูใบได้เลย แต่ต้องเลือกจุดก่อนบันทึกรับของ'}
	</p>
</div>
