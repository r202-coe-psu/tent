<script lang="ts">
	import MapPinned from '@lucide/svelte/icons/map-pinned';
	import * as Select from '$lib/components/ui/select/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import { ALL_LINES_PICKER, type BookablePoint } from '../domain/line-points';

	/** One line of the booking and the point it is booked to now. */
	type PointLine = { key: string; name: string; pointId: string | null };

	/**
	 * Where each line goes, at a shelter with drop-off points (CR-206 FR-MP-8 – FR-MP-10): one
	 * dropdown per line (owner 2026-10-30). With one point there is nothing to pick: its name is
	 * shown and every line takes it. The caller renders this only for a self drop-off at a
	 * shelter with points (FR-MP-11).
	 */
	let {
		points,
		lines,
		idPrefix,
		activePicker = null,
		onPick,
		onPickAll,
		onActivate
	}: {
		points: BookablePoint[];
		lines: PointLine[];
		/** Keeps the control ids unique where two of these sections could meet. */
		idPrefix: string;
		/** The picker a tap on the map fills: a line's key, or {@link ALL_LINES_PICKER}. */
		activePicker?: string | null;
		onPick: (key: string, pointId: string) => void;
		/** "ส่งทุกรายการที่จุดเดียวกัน" — every line to one point. */
		onPickAll: (pointId: string) => void;
		/** A picker was opened or used — it becomes the one a map tap fills. */
		onActivate?: (picker: string) => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	// The shortcut shows a point only while every line already shares it.
	const sharedPointId = $derived(
		lines.length > 0 && lines.every((line) => line.pointId === lines[0].pointId)
			? lines[0].pointId
			: null
	);

	function pointName(pointId: string | null): string | null {
		return points.find((point) => point.id === pointId)?.name ?? null;
	}
</script>

{#snippet picker(
	key: string,
	value: string | null,
	ariaLabel: string,
	id: string,
	placeholder: string,
	pick: (pointId: string) => void
)}
	<Select.Root
		type="single"
		value={value ?? ''}
		onOpenChange={(open) => {
			if (open) onActivate?.(key);
		}}
		onValueChange={(next) => {
			if (!next) return;
			onActivate?.(key);
			pick(next);
		}}
	>
		<Select.Trigger {id} aria-label={ariaLabel} class="h-11 w-full bg-white text-sm">
			<span>{pointName(value) ?? placeholder}</span>
		</Select.Trigger>
		<Select.Content>
			{#each points as point (point.id)}
				<Select.Item value={point.id} label={point.name}>{point.name}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/snippet}

{#if points.length === 1}
	<div
		class="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3"
		data-testid="drop-off-single-point"
	>
		<MapPinned class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
		<div>
			<p class="text-xs font-bold text-slate-500">{t.dropOffSinglePointLabel}</p>
			<p class="text-sm font-bold text-slate-900">{points[0].name}</p>
		</div>
	</div>
{:else if points.length > 1}
	<div class="space-y-3" data-testid="drop-off-points-section">
		<div>
			<span class="flex items-center gap-2 text-sm font-bold text-slate-800">
				<MapPinned class="h-4 w-4 text-slate-500" />
				{t.dropOffPointsTitle}
			</span>
			<p class="mt-1 text-xs leading-relaxed text-slate-500">{t.dropOffPointsDesc}</p>
		</div>

		{#if lines.length > 1}
			<div
				class="space-y-1.5 rounded-xl border bg-white p-3 {activePicker === ALL_LINES_PICKER
					? 'border-domain-donation'
					: 'border-slate-200'}"
				data-testid="drop-off-point-all"
				data-active={activePicker === ALL_LINES_PICKER}
			>
				<p class="text-xs font-bold text-slate-600">{t.dropOffPointsAllSame}</p>
				{@render picker(
					ALL_LINES_PICKER,
					sharedPointId,
					t.dropOffPointsAllSame,
					`${idPrefix}-all`,
					t.dropOffPointsMixed,
					onPickAll
				)}
			</div>
		{/if}

		<ul class="space-y-2">
			{#each lines as line, index (line.key)}
				{@const label = t.dropOffPointLineAria.replace('{name}', line.name)}
				<li
					class="space-y-1.5 rounded-xl border bg-white p-3 {activePicker === line.key
						? 'border-domain-donation'
						: 'border-slate-200'}"
					data-testid="drop-off-point-line-{index}"
					data-active={activePicker === line.key}
				>
					<p class="truncate text-sm font-bold text-slate-800">{line.name}</p>
					{@render picker(
						line.key,
						line.pointId,
						label,
						`${idPrefix}-line-${index}`,
						t.dropOffPointsSelectPlaceholder,
						(pointId) => onPick(line.key, pointId)
					)}
				</li>
			{/each}
		</ul>
	</div>
{/if}
