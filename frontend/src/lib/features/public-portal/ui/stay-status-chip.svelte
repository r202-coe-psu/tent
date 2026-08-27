<script lang="ts">
	import {
		publicStayStatusLabel,
		publicStayStatusTone,
		type StayStatusTone
	} from '../domain/stay-status';
	import { langState } from '$lib/states/i18n.svelte';

	interface Props {
		status: string | null | undefined;
		/** Appended in parentheses — the shelter the person is at, where it helps. */
		detail?: string | null;
		size?: 'sm' | 'md';
	}

	const { status, detail = null, size = 'md' }: Props = $props();

	// Plain Tailwind palette colours rather than theme tokens: the public search
	// results page already reads as a status board (green / orange / blue chips),
	// and these five tones extend that vocabulary instead of competing with it.
	const TONE_CLASS: Record<StayStatusTone, string> = {
		safe: 'border-green-200 bg-green-50 text-green-700',
		pending: 'border-amber-200 bg-amber-50 text-amber-700',
		moved: 'border-orange-200 bg-orange-50 text-orange-700',
		ended: 'border-blue-200 bg-blue-50 text-blue-700',
		grave: 'border-slate-300 bg-slate-100 text-slate-700'
	};

	const TONE_DOT: Record<StayStatusTone, string> = {
		safe: 'bg-green-500',
		pending: 'bg-amber-500',
		moved: 'bg-orange-500',
		ended: 'bg-blue-500',
		grave: 'bg-slate-500'
	};

	const tone = $derived(publicStayStatusTone(status));
	const label = $derived(publicStayStatusLabel(status, langState.current as 'th' | 'en'));
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border font-bold {TONE_CLASS[tone]} {size ===
	'sm'
		? 'px-2.5 py-1 text-xs'
		: 'px-3 py-1.5 text-sm'}"
>
	<span class="h-2 w-2 shrink-0 rounded-full {TONE_DOT[tone]}"></span>
	{label}{detail ? ` (${detail})` : ''}
</span>
