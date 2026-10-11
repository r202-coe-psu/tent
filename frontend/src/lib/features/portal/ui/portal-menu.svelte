<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Globe from '@lucide/svelte/icons/globe';
	import { resolve } from '$app/paths';
	import {
		PORTAL_PUBLIC_LINK,
		canSeePortalPublicLink,
		filterPortalMenu,
		portalDepartmentCssVars,
		type PortalFeatures
	} from '../domain/portal-menu';
	import {
		PORTAL_DEPARTMENT_ALL,
		filterPortalDepartments,
		portalLayoutMode,
		resolvePortalDepartmentSelection,
		type PortalDepartmentSelection
	} from '../domain/portal-layout';
	import { PORTAL_ICONS } from './portal-icons';
	import PortalDepartmentSection from './portal-department-section.svelte';
	import { readPortalDeptFilter, writePortalDeptFilter } from './portal-dept-filter-storage';

	interface Props {
		roles: readonly string[];
		selectedShelterCode: string | null | undefined;
		features: PortalFeatures;
		/** Real signed-in username; keys the remembered department chip. */
		username: string;
	}

	let { roles, selectedShelterCode, features, username }: Props = $props();

	const views = $derived(filterPortalMenu({ roles, shelterCode: selectedShelterCode, features }));
	const mode = $derived(portalLayoutMode(views));
	const showPublicLink = $derived(canSeePortalPublicLink(roles));

	// The chip picked in this session, tagged with its user so a user switch never shows another
	// user's choice. Until a chip is picked, the value comes from this user's stored choice.
	let picked = $state<{ user: string; selection: PortalDepartmentSelection } | null>(null);
	const stored = $derived(
		picked?.user === username ? picked.selection : readPortalDeptFilter(username)
	);
	const selection = $derived(resolvePortalDepartmentSelection(views, stored));
	const visibleViews = $derived(filterPortalDepartments(views, stored));

	function choose(next: PortalDepartmentSelection) {
		picked = { user: username, selection: next };
		writePortalDeptFilter(username, next);
	}

	const chipBase =
		'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none';
</script>

<div class="space-y-6">
	{#if views.length > 0 && mode === 'overview'}
		<div class="space-y-4">
			<div
				role="group"
				aria-label="กรองเมนูตามฝ่าย"
				class="sticky top-[var(--portal-sticky-top)] z-30 -mx-4 bg-[#F8FAFC]/95 px-4 backdrop-blur-sm sm:-mx-0 sm:px-0"
			>
				<div class="flex gap-2 overflow-x-auto px-1 py-2">
					<button
						type="button"
						aria-pressed={selection === PORTAL_DEPARTMENT_ALL}
						onclick={() => choose(PORTAL_DEPARTMENT_ALL)}
						class={[
							chipBase,
							selection === PORTAL_DEPARTMENT_ALL
								? 'border-slate-900 bg-slate-900 text-white'
								: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
						]}
					>
						{#if selection === PORTAL_DEPARTMENT_ALL}
							<Check class="size-4 shrink-0" aria-hidden="true" />
						{/if}
						ทั้งหมด
					</button>
					{#each views as view (view.id)}
						{@const Icon = PORTAL_ICONS[view.icon]}
						{@const pressed = selection === view.id}
						{@const cssVars = portalDepartmentCssVars(view)}
						<button
							type="button"
							aria-pressed={pressed}
							onclick={() => choose(view.id)}
							style:--c={cssVars['--c']}
							style:--c-strong={cssVars['--c-strong']}
							style:--c-subtle={cssVars['--c-subtle']}
							style:--c-border={cssVars['--c-border']}
							style:--c-text={cssVars['--c-text']}
							class={[
								chipBase,
								pressed
									? 'border-(color:--c-strong) bg-(--c-strong) text-white'
									: 'border-(color:--c-border) bg-(--c-subtle) text-(color:--c-text) hover:bg-white'
							]}
						>
							{#if pressed}
								<Check class="size-4 shrink-0" aria-hidden="true" />
							{:else}
								<span aria-hidden="true" class="flex shrink-0"><Icon class="size-4" /></span>
							{/if}
							<span>{view.label}</span>
							<span
								class="shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums {pressed
									? 'bg-white/20 text-white'
									: 'bg-white text-(color:--c-text)'}"
							>
								{view.items.length}
							</span>
						</button>
					{/each}
				</div>
			</div>

			{#if selection === PORTAL_DEPARTMENT_ALL}
				<div
					class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] items-start gap-4"
				>
					{#each visibleViews as department (department.id)}
						<PortalDepartmentSection {department} {selectedShelterCode} variant="compact" />
					{/each}
				</div>
			{:else}
				{#each visibleViews as department (department.id)}
					<PortalDepartmentSection {department} {selectedShelterCode} />
				{/each}
			{/if}
		</div>
	{:else if views.length > 0}
		{#each views as department (department.id)}
			<PortalDepartmentSection {department} {selectedShelterCode} />
		{/each}
	{:else}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-base text-slate-600 shadow-2xs"
		>
			ยังไม่มีเมนูสำหรับบทบาทของคุณในศูนย์นี้
		</div>
	{/if}

	{#if showPublicLink}
		<footer class="border-t border-slate-200/80 pt-4">
			<a
				href={resolve(PORTAL_PUBLIC_LINK.href)}
				class="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
			>
				<Globe class="size-4" aria-hidden="true" />
				{PORTAL_PUBLIC_LINK.label}
			</a>
		</footer>
	{/if}
</div>
