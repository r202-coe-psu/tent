<script module lang="ts">
	export type PeopleStatFilter = 'all' | 'pending' | 'ready';
</script>

<script lang="ts">
	/**
	 * "People" tab (Tab 3) top pill row — owner-approved mockup, 2026-08-28.
	 *
	 * `pending`/`ready` here are a volunteer-level split by `identity_verified`
	 * (schema.md §2.8), NOT the Control Hub header's `pendingApproval` tile
	 * (`domain/hub-metrics.ts`), which counts `job_application`s awaiting
	 * review — the two use the same Thai label ("รออนุมัติ") for different
	 * things. Flagged for the owner: this naming collision should probably be
	 * resolved in a CR (e.g. rename one of the two).
	 */
	import Users from '@lucide/svelte/icons/users';

	let {
		total,
		pending,
		ready,
		selected = $bindable<PeopleStatFilter>('all')
	}: {
		total: number;
		pending: number;
		ready: number;
		selected?: PeopleStatFilter;
	} = $props();

	const pills: { key: PeopleStatFilter; label: string; value: number; dotClass?: string }[] =
		$derived([
			{ key: 'all', label: 'ทั้งหมด', value: total },
			{ key: 'pending', label: 'รออนุมัติ', value: pending, dotClass: 'bg-amber-400' },
			{ key: 'ready', label: 'พร้อมปฏิบัติงาน', value: ready, dotClass: 'bg-emerald-500' }
		]);
</script>

<div class="flex flex-wrap items-center gap-2">
	{#each pills as pill (pill.key)}
		<button
			type="button"
			aria-pressed={selected === pill.key}
			onclick={() => (selected = pill.key)}
			class="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition-colors {selected ===
			pill.key
				? 'border-primary-dark bg-primary-dark text-white'
				: 'border-border bg-background text-foreground hover:bg-muted'}"
		>
			{#if pill.key === 'all'}
				<Users class="h-4 w-4 shrink-0" />
			{:else}
				<span class="h-2.5 w-2.5 shrink-0 rounded-full {pill.dotClass}"></span>
			{/if}
			{pill.label}
			<span
				class="grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs tabular-nums {selected ===
				pill.key
					? 'bg-white/20 text-white'
					: 'bg-muted text-muted-foreground'}"
			>
				{pill.value}
			</span>
		</button>
	{/each}
</div>
