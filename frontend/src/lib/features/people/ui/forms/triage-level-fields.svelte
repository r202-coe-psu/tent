<script lang="ts">
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { triageLevelSchema, type TriageLevel } from '../../domain/people';
	import { TRIAGE_I18N } from '../_constants/triage.i18n';
	import { TRIAGE_DOT_CLASS } from '../shared/triage-badge.svelte';

	let {
		triage_level = $bindable<TriageLevel>('green'),
		disabled = false,
		idPrefix = 'triage'
	}: {
		triage_level?: TriageLevel;
		disabled?: boolean;
		idPrefix?: string;
	} = $props();

	const t = $derived(getTranslation(TRIAGE_I18N, langState.current));

	const SELECTED_CLASS: Record<TriageLevel, string> = {
		green: 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500',
		yellow: 'border-amber-500 bg-amber-50 ring-1 ring-amber-500',
		red: 'border-red-500 bg-red-50 ring-1 ring-red-500'
	};
</script>

<RadioGroup.Root
	value={triage_level}
	onValueChange={(v) => {
		const parsed = triageLevelSchema.safeParse(v);
		if (parsed.success) triage_level = parsed.data;
	}}
	{disabled}
	aria-label={t.title}
	class="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
>
	{#each triageLevelSchema.options as level (level)}
		{@const selected = triage_level === level}
		<label
			for="{idPrefix}-{level}"
			class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all {selected
				? `${SELECTED_CLASS[level]} shadow-xs`
				: 'border-border bg-card hover:bg-muted/30'} {disabled
				? 'pointer-events-none opacity-60'
				: ''}"
		>
			<RadioGroup.Item value={level} id="{idPrefix}-{level}" class="mt-0.5" />
			<div class="min-w-0 space-y-0.5 break-words">
				<span class="flex items-center gap-1.5 text-sm font-semibold text-foreground">
					<span class="size-2.5 shrink-0 rounded-full {TRIAGE_DOT_CLASS[level]}" aria-hidden="true"
					></span>
					{t.levels[level].label}
				</span>
				<span class="block text-xs text-muted-foreground">{t.levels[level].desc}</span>
			</div>
		</label>
	{/each}
</RadioGroup.Root>
