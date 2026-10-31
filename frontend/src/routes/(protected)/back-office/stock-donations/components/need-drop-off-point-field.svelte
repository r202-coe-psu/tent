<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { NeedDropOffPointOption, NeedPointField } from '$lib/features/operations';

	interface Props {
		id: string;
		field: NeedPointField;
		points: readonly NeedDropOffPointOption[];
		/** The staff's current choice; `null` = nothing picked yet. */
		value: string | null;
		onchange: (pointId: string) => void;
	}

	let { id, field, points, value, onchange }: Props = $props();

	const selectedName = $derived(points.find((p) => p.id === value)?.name ?? '');
</script>

{#if field.mode === 'auto'}
	<div>
		<span class="mb-1.5 block text-xs font-bold text-foreground">จุดรับบริจาค</span>
		<div
			class="flex h-10 items-center rounded-xl border border-border/60 bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
		>
			{points[0]?.name}
		</div>
		<p class="mt-1.5 text-3xs text-muted-foreground">ศูนย์นี้มีจุดรับบริจาคจุดเดียว</p>
	</div>
{:else if field.mode === 'required'}
	<div>
		<Label for={id} class="mb-1.5 text-xs font-bold text-foreground">
			จุดรับบริจาค <span class="text-destructive">*</span>
		</Label>
		<Select.Root type="single" value={value ?? ''} onValueChange={onchange}>
			<Select.Trigger {id} class="h-10 w-full rounded-xl text-xs data-[size=default]:h-10">
				{selectedName || 'เลือกจุดรับบริจาค'}
			</Select.Trigger>
			<Select.Content>
				{#each points as point (point.id)}
					<Select.Item value={point.id} label={point.name} />
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="mt-1.5 text-3xs text-muted-foreground">
			ผู้บริจาคไม่ต้องเลือกจุดเอง — ของที่จองจากประกาศนี้จะไปจุดที่เลือกไว้
		</p>
	</div>
{/if}
