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
	}

	let { department, selectedShelterCode }: Props = $props();

	const Icon = $derived(PORTAL_ICONS[department.icon]);
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
	class="space-y-4"
>
	<header class="flex items-center gap-3">
		<span
			class="flex size-11 shrink-0 items-center justify-center rounded-xl border border-(color:--c-border) bg-(--c-subtle) text-(color:--c)"
			aria-hidden="true"
		>
			<Icon class="size-6" />
		</span>
		<div class="min-w-0">
			<h2 id={headingId} class="text-lg font-bold text-slate-900 sm:text-xl">
				{department.label}
			</h2>
			<p class="text-sm text-slate-600">{department.desc}</p>
		</div>
	</header>

	{#each blocks as block (block.key)}
		<div class="space-y-2">
			{#if block.label}
				<h3 class="text-sm font-semibold text-slate-600">{block.label}</h3>
			{/if}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each block.items as { item, state } (item.id)}
					<PortalMenuTile {item} {state} {selectedShelterCode} />
				{/each}
			</div>
		</div>
	{/each}
</section>
