<script lang="ts">
	import BackofficeNavbar from '$lib/components/backoffice-navbar.svelte';
	import type { LayoutProps } from './$types';
	import { backofficeNavbarGroups, isGroup } from '$lib/components/backoffice-navbar/static';
	import { page } from '$app/state';
	import { backofficeState } from '$lib/stores/backoffice.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, shelterCodeFromRoles } from '$lib/auth/roles';
	import { useShelters } from '$lib/features/shelters';
	import { Select, SelectTrigger, SelectContent, SelectItem } from '$lib/components/ui/select';
	import Building from '@lucide/svelte/icons/building';
	import { ReauthDialog } from '$lib/features/login';

	let { children }: LayoutProps = $props();
	let reauthOpen = $state(false);

	// Fetch shelters list dynamically
	const sheltersQuery = useShelters();

	function shelterLabel(code: string, name: string) {
		return `${code} — ${name}`;
	}

	// Find the current page info (label, icon) dynamically
	const currentPageNode = $derived.by(() => {
		let currentPath = page.url.pathname;
		if (currentPath.startsWith('/back-office/households')) {
			currentPath = '/back-office/evacuee-management';
		}
		for (const group of backofficeNavbarGroups) {
			for (const item of group.items) {
				if (isGroup(item)) {
					for (const child of item.children) {
						if (child.href && currentPath.startsWith(child.href)) {
							return child;
						}
					}
				} else {
					if (item.href && currentPath.startsWith(item.href)) {
						return item;
					}
				}
			}
		}
		return null;
	});

	const pageTitle = $derived(currentPageNode?.label ?? 'ระบบส่วนหลัง (Back-Office)');
	const PageIcon = $derived(currentPageNode?.icon ?? Building);

	// Get user roles and scoped shelter
	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const isSM = $derived(isShelterManager(roles));
	const userShelterCode = $derived(shelterCodeFromRoles(roles));

	// Filter available shelters based on roles
	const availableShelters = $derived.by(() => {
		const allShelters = sheltersQuery.data ?? [];
		if (isSA || isSM) {
			return allShelters;
		}
		if (userShelterCode) {
			return allShelters.filter((s) => s.code === userShelterCode);
		}
		return [];
	});

	// Default to the user's own shelter when nothing valid is selected yet;
	// fall back to the first available shelter for roles with no home shelter
	// (system_admin). Bound directly to shelterStore — the store
	// getShelterCode()/getShelterDb() actually read — so switching here
	// re-scopes back-office data instead of being a disconnected value.
	$effect(() => {
		const shelters = availableShelters;
		if (shelters.length === 0) return;
		const current = shelterStore.selectedShelterCode;
		if (current && shelters.some((s) => s.code === current)) return;
		const ownShelter = shelters.find((s) => s.code === userShelterCode);
		shelterStore.selectedShelterCode = ownShelter?.code ?? shelters[0].code;
	});

	const selectedShelter = $derived(
		availableShelters.find((s) => s.code === shelterStore.selectedShelterCode)
	);
	const selectedShelterLabel = $derived(
		selectedShelter
			? shelterLabel(selectedShelter.code, selectedShelter.name)
			: (shelterStore.selectedShelterCode ?? 'เลือกศูนย์อพยพ')
	);
</script>

<div
	class="flex min-h-0 w-full flex-1 flex-col items-stretch overflow-hidden bg-muted/30 text-foreground md:flex-row"
>
	<BackofficeNavbar />
	<div class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
		<!-- Static Top Header Bar (shared by all backoffice pages) -->
		<header
			class="flex h-16 shrink-0 flex-col justify-center border-b border-sidebar-border bg-card px-4 md:px-6"
		>
			<div class="flex items-center justify-between gap-4">
				<!-- Left: Page Title & Icon -->
				<div class="flex items-center gap-2">
					<PageIcon class="size-4 shrink-0 text-primary" />
					<h1 class="text-sm font-bold text-foreground">{pageTitle}</h1>
				</div>

				<!-- Right: Controls -->
				<div class="flex items-center gap-2 md:gap-3">
					<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span class="hidden shrink-0 sm:inline">ศูนย์อพยพ:</span>
						<Select type="single" bind:value={shelterStore.selectedShelterCode}>
							<SelectTrigger class="h-9 w-[200px] md:w-[280px]">
								<span class="truncate">{selectedShelterLabel}</span>
							</SelectTrigger>
							<SelectContent>
								{#if sheltersQuery.isLoading}
									<SelectItem value="" disabled label="กำลังโหลด..." />
								{:else if availableShelters.length === 0}
									<SelectItem value="" disabled label="ไม่มีศูนย์พักพิงที่เข้าถึงได้" />
								{:else}
									{#each availableShelters as shelter (shelter.code)}
										<SelectItem
											value={shelter.code}
											label={shelterLabel(shelter.code, shelter.name)}
										/>
									{/each}
								{/if}
							</SelectContent>
						</Select>
					</div>

					{#if backofficeState.isOffline}
						<button
							type="button"
							class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-600 hover:bg-amber-500/20"
							onclick={() => (reauthOpen = true)}
						>
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"></span>
							Session หมดอายุ
						</button>
					{:else}
						<span
							class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
							Online
						</span>
					{/if}
				</div>
			</div>
		</header>

		<!-- Content Area: evacuee management owns scrolling inside its tab content. -->
		<div
			class="flex min-h-0 flex-1 flex-col {page.url.pathname === '/back-office/evacuee-management'
				? 'overflow-hidden'
				: 'overflow-y-auto'}"
		>
			{@render children()}
		</div>
	</div>
</div>

<ReauthDialog bind:open={reauthOpen} />
