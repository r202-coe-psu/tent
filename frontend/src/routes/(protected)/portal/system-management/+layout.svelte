<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	import {
		systemManagementNavbarGroups,
		isGroup
	} from '$lib/components/system-management-navbar/static';
	import SystemManagementNavbar from '$lib/components/system-management-navbar.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, shelterCodeFromRoles } from '$lib/auth/roles';
	import { useShelters } from '$lib/features/shelters';
	import { Select, SelectTrigger, SelectContent, SelectItem } from '$lib/components/ui/select';
	import Building from '@lucide/svelte/icons/building';

	let { children }: LayoutProps = $props();

	const sheltersQuery = useShelters();
	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const isSM = $derived(isShelterManager(roles));
	const userShelterCode = $derived(shelterCodeFromRoles(roles));

	const availableShelters = $derived.by(() => {
		const allShelters = sheltersQuery.data ?? [];
		if (isSA || isSM) return allShelters;
		if (userShelterCode) return allShelters.filter((s) => s.code === userShelterCode);
		return [];
	});

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
			? `${selectedShelter.code} — ${selectedShelter.name}`
			: (shelterStore.selectedShelterCode ?? 'เลือกศูนย์อพยพ')
	);

	const currentPageNode = $derived.by(() => {
		const currentPath = page.url.pathname;
		for (const group of systemManagementNavbarGroups) {
			for (const item of group.items) {
				if (isGroup(item)) {
					for (const child of item.children) {
						if (child.href && currentPath.startsWith(child.href)) return child;
					}
				} else if (item.href && currentPath.startsWith(item.href)) {
					return item;
				}
			}
		}
		return null;
	});

	const pageTitle = $derived(currentPageNode?.label ?? 'ทะเบียนพื้นที่และศูนย์พักพิง');
	const PageIcon = $derived(currentPageNode?.icon ?? Building);
</script>

<div
	class="flex min-h-0 w-full flex-1 flex-col items-stretch overflow-hidden bg-muted/30 text-foreground md:flex-row"
>
	<SystemManagementNavbar />
	<div class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
		<header
			class="flex h-16 shrink-0 flex-col justify-center border-b border-sidebar-border bg-card px-4 md:px-6"
		>
			<div class="flex items-center justify-between gap-4">
				<div class="flex items-center gap-2">
					<PageIcon class="size-4 shrink-0 text-primary" />
					<h1 class="text-sm font-bold text-foreground">{pageTitle}</h1>
				</div>

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
										<SelectItem value={shelter.code} label={`${shelter.code} — ${shelter.name}`} />
									{/each}
								{/if}
							</SelectContent>
						</Select>
					</div>

					<span
						class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
						Online
					</span>
				</div>
			</div>
		</header>

		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{@render children()}
		</div>
	</div>
</div>
