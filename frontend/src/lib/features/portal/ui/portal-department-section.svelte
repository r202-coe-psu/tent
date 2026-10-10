<script lang="ts">
	import {
		PORTAL_GROUP_LABELS,
		portalDepartmentCssVars,
		type PortalDepartmentView,
		type PortalMenuItem,
		type PortalVisibleItem
	} from '../domain/portal-menu';
	import { PORTAL_ICONS } from './portal-icons';
	import PortalMenuTile from './portal-menu-tile.svelte';

	interface Props {
		department: PortalDepartmentView;
		selectedShelterCode: string | null | undefined;
		/** `tile` = large tiles in a 3-column grid (focused layout); `compact` = rows in one column. */
		variant?: 'tile' | 'compact';
	}

	let { department, selectedShelterCode, variant = 'tile' }: Props = $props();

	const Icon = $derived(PORTAL_ICONS[department.icon]);
	const compact = $derived(variant === 'compact');
	const gridClass = $derived(
		compact ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'
	);
	const headingId = $derived(`portal-dept-${department.id}`);
	const cssVars = $derived(portalDepartmentCssVars(department));

	type Block = { key: string; label: string | null; items: PortalVisibleItem[] };

	// A department whose items declare a `group` (registration) renders captioned sub-sections;
	// every other department renders one plain grid.
	const blocks = $derived.by<Block[]>(() => {
		if (!department.items.some(({ item }) => item.group)) {
			return [{ key: 'all', label: null, items: department.items }];
		}
		const groups: NonNullable<PortalMenuItem['group']>[] = ['stations', 'tools'];
		return groups
			.map((group) => ({
				key: group,
				label: PORTAL_GROUP_LABELS[group],
				items: department.items.filter(({ item }) => item.group === group)
			}))
			.filter((block) => block.items.length > 0);
	});
</script>

<section
	aria-labelledby={headingId}
	style:--c={cssVars['--c']}
	style:--c-strong={cssVars['--c-strong']}
	style:--c-subtle={cssVars['--c-subtle']}
	style:--c-border={cssVars['--c-border']}
	style:--c-text={cssVars['--c-text']}
	class="overflow-hidden rounded-2xl border border-(color:--c-border) bg-white shadow-2xs"
>
	<header
		class={[
			'flex items-center gap-3 border-b border-(color:--c-border) bg-(--c-subtle)',
			compact ? 'px-4 py-3' : 'px-4 py-3 sm:px-6 sm:py-4'
		]}
	>
		<span
			class={[
				'flex shrink-0 items-center justify-center rounded-xl bg-(--c-strong) text-white',
				compact ? 'size-9' : 'size-11'
			]}
			aria-hidden="true"
		>
			<Icon class={compact ? 'size-5' : 'size-6'} />
		</span>
		<div class="min-w-0 flex-1">
			<h2
				id={headingId}
				class={['font-bold text-(color:--c-text)', compact ? 'text-base' : 'text-lg sm:text-xl']}
			>
				{department.label}
			</h2>
			<p class={['text-sm text-slate-600', compact && 'line-clamp-1']}>{department.desc}</p>
		</div>
		<span
			class="shrink-0 rounded-full border border-(color:--c-border) bg-white px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-(color:--c-text) tabular-nums"
		>
			{department.items.length} เมนู
		</span>
	</header>

	<div class={compact ? 'space-y-4 p-3 sm:p-4' : 'space-y-5 p-4 sm:p-6'}>
		{#each blocks as block (block.key)}
			<div class="space-y-2">
				{#if block.label}
					<h3 class="text-sm font-semibold text-slate-600">{block.label}</h3>
				{/if}
				<div class={gridClass}>
					{#each block.items as { item, state } (item.id)}
						<PortalMenuTile {item} {state} {selectedShelterCode} {variant} />
					{/each}
				</div>
			</div>
		{/each}
	</div>
</section>
