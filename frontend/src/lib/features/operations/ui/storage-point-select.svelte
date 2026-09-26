<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { DEFAULT_STORAGE_LABEL, type StoragePointRef } from '../domain/lot-storage';

	/**
	 * "สถานที่จัดเก็บ" picker over the shelter's storage points
	 * (draft-shelter-storage-points). `value` is the point id; '' = unspecified
	 * (main store). Callers write the lot via `storageLotFields(selected)`.
	 */
	let {
		points,
		value = $bindable(''),
		onchange,
		id,
		disabled = false,
		triggerProps = {}
	}: {
		points: readonly StoragePointRef[];
		value?: string;
		onchange?: (point: StoragePointRef | null) => void;
		id?: string;
		disabled?: boolean;
		/** Form.Control `props` (id, aria-*) when used inside a Form.Field. */
		triggerProps?: Record<string, unknown>;
	} = $props();

	const UNSPECIFIED_LABEL = `ไม่ระบุ (${DEFAULT_STORAGE_LABEL})`;

	const selected = $derived(points.find((p) => p.id === value) ?? null);

	function handleChange(next: string) {
		value = next;
		onchange?.(points.find((p) => p.id === next) ?? null);
	}
</script>

<Select.Root type="single" {value} onValueChange={handleChange} {disabled}>
	<Select.Trigger
		{id}
		{...triggerProps}
		class="h-11 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm font-medium shadow-xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none sm:h-10"
	>
		{selected ? `📍 ${selected.name}` : UNSPECIFIED_LABEL}
	</Select.Trigger>
	<Select.Content>
		<Select.Item value="" label={UNSPECIFIED_LABEL} />
		{#each points as point (point.id)}
			<Select.Item value={point.id} label={`📍 ${point.name}`} />
		{/each}
	</Select.Content>
</Select.Root>
{#if points.length === 0}
	<p class="mt-1 text-xs text-muted-foreground">
		ศูนย์นี้ยังไม่ได้ตั้งค่าจุดเก็บของ — ผู้ดูแลศูนย์ตั้งค่าได้ที่หน้าแก้ไขศูนย์ หัวข้อ "จุดเก็บของ"
	</p>
{/if}
