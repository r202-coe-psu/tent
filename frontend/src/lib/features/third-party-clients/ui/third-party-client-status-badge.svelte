<script lang="ts">
	import Ban from '@lucide/svelte/icons/ban';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';

	let { active }: { active: boolean } = $props();
</script>

{#if active}
	<span
		class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900"
	>
		<CheckCircle2 class="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
		ใช้งานอยู่
	</span>
{:else}
	<span
		class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
	>
		<Ban class="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
		เพิกถอนแล้ว
	</span>
{/if}
