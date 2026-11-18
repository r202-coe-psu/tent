<script module lang="ts">
	import type { TriageLevel } from '../../domain/people';

	/** Status colours (green / amber / red) — always shown with the colour name as text. */
	export const TRIAGE_BADGE_CLASS: Record<TriageLevel, string> = {
		green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		yellow: 'border-amber-200 bg-amber-50 text-amber-900',
		red: 'border-red-200 bg-red-50 text-red-900'
	};

	export const TRIAGE_DOT_CLASS: Record<TriageLevel, string> = {
		green: 'bg-emerald-600',
		yellow: 'bg-amber-500',
		red: 'bg-red-600'
	};
</script>

<script lang="ts">
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { TRIAGE_I18N } from '../_constants/triage.i18n';

	let { level, class: className = '' }: { level: TriageLevel; class?: string } = $props();

	const t = $derived(getTranslation(TRIAGE_I18N, langState.current));
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold {TRIAGE_BADGE_CLASS[
		level
	]} {className}"
	data-triage={level}
>
	<span class="size-2 shrink-0 rounded-full {TRIAGE_DOT_CLASS[level]}" aria-hidden="true"></span>
	{t.badgePrefix}: {t.levels[level].label}
</span>
