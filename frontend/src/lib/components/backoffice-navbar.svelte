<script lang="ts">
	import { page } from '$app/state';
	import House from '@lucide/svelte/icons/house';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Menu from '@lucide/svelte/icons/menu';
	import * as Sheet from '$lib/components/ui/sheet';
	import StaffAccountMenu from '$lib/components/staff-account-menu.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { afterNavigate } from '$app/navigation';
	import { isSystemAdmin, isShelterManager, formatRoleList } from '$lib/auth/roles';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		backofficeNavbarGroups,
		backofficeHomePath,
		isGroup,
		type BackofficeNavbarNode
	} from './backoffice-navbar/static';

	let collapsed = $state(false);
	let mobileMenuOpen = $state(false);

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const isManager = $derived(isSA || isShelterManager(roles, shelterStore.selectedShelterCode));

	function closeMobileMenu() {
		mobileMenuOpen = false;
	}

	afterNavigate(() => {
		mobileMenuOpen = false;
	});

	function normalize(path: string): string {
		return path.replace(/\/$/, '');
	}

	function isActive(href: BackofficeNavbarNode['href']): boolean {
		if (!href) return false;
		let path = normalize(page.url.pathname);
		if (path.startsWith('/back-office/households')) {
			path = '/back-office/evacuee-management';
		}
		const target = normalize(String(href));
		return path === target || path.startsWith(target + '/');
	}

	function groupIsActive(node: BackofficeNavbarNode): boolean {
		if (!isGroup(node)) return false;
		return node.children.some((c) => (isGroup(c) ? groupIsActive(c) : isActive(c.href)));
	}

	function collectAllNodes(nodes: BackofficeNavbarNode[]): BackofficeNavbarNode[] {
		const result: BackofficeNavbarNode[] = [];
		for (const node of nodes) {
			result.push(node);
			if (isGroup(node)) {
				result.push(...collectAllNodes(node.children));
			}
		}
		return result;
	}

	const allNavbarNodes = $derived(collectAllNodes(backofficeNavbarGroups.flatMap((g) => g.items)));

	const expandedKeys = $derived(
		new Set(allNavbarNodes.filter(groupIsActive).map((n) => (n as { label: string }).label))
	);

	let manualOverrides = $state<Record<string, boolean>>({});

	function isExpanded(label: string, node: BackofficeNavbarNode): boolean {
		if (label in manualOverrides) return manualOverrides[label];
		return expandedKeys.has(label) || groupIsActive(node);
	}

	function toggleExpanded(label: string) {
		const node = allNavbarNodes.find((n) => 'label' in n && n.label === label);
		if (!node) return;
		manualOverrides[label] = !isExpanded(label, node);
	}

	// Reactive through closure on `isSA` ($derived) — only called from template blocks
	function canSee(node: BackofficeNavbarNode): boolean {
		if ('requiresAdmin' in node && node.requiresAdmin) return isSA;
		if ('requiresManager' in node && node.requiresManager) return isManager;
		return true;
	}
</script>

<aside
	class="sticky top-0 z-20 hidden h-[var(--app-shell-height)] shrink-0 flex-col self-start border-r border-sidebar-border bg-card text-foreground transition-[width] duration-200 lg:flex {collapsed
		? 'w-16'
		: 'w-72'}"
>
	<div
		class="sticky top-0 z-20 flex items-center bg-card {collapsed
			? 'justify-center px-2 py-5'
			: 'justify-between gap-2 p-5'}"
	>
		<a
			href={backofficeHomePath}
			class="flex items-center gap-3 {collapsed ? 'flex-none justify-center' : 'flex-1'}"
			aria-label="กลับหน้าเลือกเมนูหลัก"
		>
			<img
				src="/logo.png"
				alt="PSU Smart Shelter"
				class="h-8 w-8 shrink-0 rounded-lg object-contain"
			/>
			{#if !collapsed}
				<span class="truncate text-base font-bold tracking-tight text-foreground">
					PSU Smart Shelter
				</span>
			{/if}
		</a>
		<button
			type="button"
			class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-card text-xs text-muted-foreground shadow-sm hover:bg-muted {collapsed
				? 'absolute top-6 -right-3 z-30'
				: ''}"
			onclick={() => (collapsed = !collapsed)}
			aria-label={collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
		>
			<ChevronLeft class="h-3 w-3 transition-transform {collapsed ? 'rotate-180' : ''}" />
		</button>
	</div>

	<div class="no-scrollbar flex-1 overflow-y-auto">
		<div class="sticky top-0 z-10 bg-card p-4 pb-2">
			<a
				href={backofficeHomePath}
				class="flex w-full items-center justify-center rounded-xl bg-muted py-2.5 text-sm font-normal text-foreground transition-colors hover:bg-muted/70 {collapsed
					? 'px-2'
					: 'gap-2 px-4'}"
				title="กลับหน้าเลือกเมนูหลัก"
			>
				<House class="h-4 w-4 shrink-0 text-muted-foreground" />
				{#if !collapsed}<span>กลับหน้าเลือกเมนูหลัก</span>{/if}
			</a>
		</div>

		<div class="space-y-6 px-4 pt-2 pb-4 text-xs font-medium text-muted-foreground">
			{#each backofficeNavbarGroups as group (group.title)}
				{@const visibleItems = group.items.filter(canSee)}
				{#if visibleItems.length > 0}
					<div>
						{#if !collapsed}
							<div
								class="mb-2 px-3 text-2xs font-bold tracking-wider text-muted-foreground/70 uppercase"
							>
								{group.title}
							</div>
						{/if}
						<div class="space-y-1">
							{#each visibleItems as item (item.label)}
								{@const Icon = item.icon}
								{#if isGroup(item)}
									{@const expanded = isExpanded(item.label, item)}
									{@const active = groupIsActive(item)}
									<button
										type="button"
										class="flex w-full items-center rounded-xl px-4 py-3 transition-colors {collapsed
											? 'justify-center'
											: 'gap-3'} {active ? 'bg-primary-muted text-primary' : 'hover:bg-muted/60'}"
										onclick={() => toggleExpanded(item.label)}
										aria-expanded={expanded}
										title={item.label}
									>
										<Icon
											class="h-4 w-4 shrink-0 {active ? 'text-primary' : 'text-muted-foreground'}"
										/>
										{#if !collapsed}
											<span class="flex-1 text-left whitespace-nowrap">{item.label}</span>
											<ChevronDown
												class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 {expanded
													? 'rotate-180'
													: ''}"
											/>
										{/if}
									</button>
									{#if expanded && !collapsed}
										<div class="mt-1 space-y-1">
											{#each item.children.filter(canSee) as child (child.label)}
												{#if isGroup(child)}
													{@const subExpanded = isExpanded(child.label, child)}
													{@const subActive = groupIsActive(child)}
													{@const SubIcon = child.icon}
													<button
														type="button"
														class="ml-4 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-4 py-2.5 transition-colors {subActive
															? 'bg-primary-muted text-primary'
															: 'hover:bg-muted/60'}"
														onclick={() => toggleExpanded(child.label)}
														aria-expanded={subExpanded}
														title={child.label}
													>
														<SubIcon
															class="h-4 w-4 shrink-0 {subActive
																? 'text-primary'
																: 'text-muted-foreground'}"
														/>
														<span class="flex-1 text-left whitespace-nowrap">{child.label}</span>
														<ChevronDown
															class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 {subExpanded
																? 'rotate-180'
																: ''}"
														/>
													</button>
													{#if subExpanded}
														<div class="mt-1 space-y-1">
															{#each child.children.filter(canSee) as subChild (subChild.label)}
																{@const subChildActive = isActive(subChild.href)}
																{@const SubChildIcon = subChild.icon}
																{#if subChild.href}
																	<a
																		href={subChild.href}
																		class="ml-8 flex items-center gap-3 rounded-xl px-4 py-2 transition-colors {subChildActive
																			? 'bg-primary font-semibold text-primary-foreground'
																			: 'hover:bg-muted/60'}"
																		aria-current={subChildActive ? 'page' : undefined}
																		title={subChild.label}
																	>
																		<SubChildIcon
																			class="h-4 w-4 shrink-0 {subChildActive
																				? 'text-primary-foreground'
																				: 'text-muted-foreground'}"
																		/>
																		<span class="whitespace-nowrap">{subChild.label}</span>
																	</a>
																{:else}
																	<span
																		class="ml-8 flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-2 text-muted-foreground opacity-50"
																		aria-disabled="true"
																		title={subChild.label}
																	>
																		<SubChildIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
																		<span class="whitespace-nowrap">{subChild.label}</span>
																	</span>
																{/if}
															{/each}
														</div>
													{/if}
												{:else}
													{@const childActive = isActive(child.href)}
													{@const ChildIcon = child.icon}
													{#if child.href}
														<a
															href={child.href}
															class="ml-4 flex items-center gap-3 rounded-xl px-4 py-2.5 transition-colors {childActive
																? 'bg-primary font-semibold text-primary-foreground'
																: 'hover:bg-muted/60'}"
															aria-current={childActive ? 'page' : undefined}
															title={child.label}
														>
															<ChildIcon
																class="h-4 w-4 shrink-0 {childActive
																	? 'text-primary-foreground'
																	: 'text-muted-foreground'}"
															/>
															<span class="whitespace-nowrap">{child.label}</span>
														</a>
													{:else}
														<span
															class="ml-4 flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-2.5 text-muted-foreground opacity-50"
															aria-disabled="true"
															title={child.label}
														>
															<ChildIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
															<span class="whitespace-nowrap">{child.label}</span>
														</span>
													{/if}
												{/if}
											{/each}
										</div>
									{/if}
								{:else}
									{@const active = isActive(item.href)}
									{#if item.href}
										<a
											href={item.href}
											class="flex items-center rounded-xl px-4 py-3 transition-colors {collapsed
												? 'justify-center'
												: 'gap-3'} {active
												? 'bg-primary font-semibold text-primary-foreground'
												: 'hover:bg-muted/60'}"
											aria-current={active ? 'page' : undefined}
											title={item.label}
										>
											<Icon
												class="h-4 w-4 shrink-0 {active
													? 'text-primary-foreground'
													: 'text-muted-foreground'}"
											/>
											{#if !collapsed}<span class="whitespace-nowrap">{item.label}</span>{/if}
										</a>
									{:else}
										<span
											class="flex cursor-not-allowed items-center rounded-xl px-4 py-3 text-muted-foreground opacity-50 {collapsed
												? 'justify-center'
												: 'gap-3'}"
											aria-disabled="true"
											title={item.label}
										>
											<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
											{#if !collapsed}<span class="whitespace-nowrap">{item.label}</span>{/if}
										</span>
									{/if}
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</div>

	<!-- Desktop Sidebar Footer -->
	<div class="mt-auto border-t border-sidebar-border bg-card p-4">
		{#if collapsed}
			<div class="flex justify-center">
				<StaffAccountMenu compact side="right" align="end" />
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				<span
					class="max-w-full self-start truncate rounded-lg border border-primary/10 bg-primary/5 px-2 py-1 text-2xs font-medium text-primary"
					title={formatRoleList(roles)}
				>
					{formatRoleList(roles)}
				</span>
				<StaffAccountMenu class="w-full" side="top" align="start" />
			</div>
		{/if}
	</div>
</aside>

<!-- Mobile Navigation -->
<div class="z-50 w-full shrink-0 border-b border-sidebar-border bg-card lg:hidden">
	<div class="flex h-16 w-full items-center justify-between px-4">
		<a href={backofficeHomePath} class="flex min-h-11 items-center gap-3" onclick={closeMobileMenu}>
			<img
				src="/logo.png"
				alt="PSU Smart Shelter"
				class="h-8 w-8 shrink-0 rounded-lg object-contain"
			/>
			<span
				class="flex min-w-0 items-center gap-1.5 text-base font-bold tracking-tight text-foreground"
			>
				<span class="truncate">PSU Smart Shelter</span>
				<span
					class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-2xs font-semibold text-primary"
				>
					Back-Office
				</span>
			</span>
		</a>

		<button
			type="button"
			class="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-sidebar-border bg-card text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
			onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			aria-label={mobileMenuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
			aria-expanded={mobileMenuOpen}
			aria-controls="backoffice-mobile-nav"
		>
			<Menu class="h-5 w-5" />
		</button>
	</div>

	<Sheet.Root bind:open={mobileMenuOpen}>
		<Sheet.Content
			id="backoffice-mobile-nav"
			side="left"
			class="gap-0 border-sidebar-border bg-card p-0 text-foreground shadow-none"
		>
			<Sheet.Header class="border-b border-sidebar-border p-4 pr-14">
				<Sheet.Title
					class="flex items-center gap-2.5 text-left text-base font-bold text-foreground"
				>
					<img src="/logo.png" alt="" class="h-7 w-7 shrink-0 rounded-md object-contain" />
					PSU Smart Shelter
				</Sheet.Title>
				<Sheet.Description class="text-left text-sm text-muted-foreground">
					เมนูแบ็กออฟฟิศ
				</Sheet.Description>
			</Sheet.Header>

			<div class="no-scrollbar flex-1 overflow-y-auto">
				<div class="border-b border-sidebar-border p-4 pb-3">
					<a
						href={backofficeHomePath}
						class="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm font-normal text-foreground transition-colors hover:bg-muted/70"
						onclick={closeMobileMenu}
						title="กลับหน้าเลือกเมนูหลัก"
					>
						<House class="h-4 w-4 shrink-0 text-muted-foreground" />
						<span>กลับหน้าเลือกเมนูหลัก</span>
					</a>
				</div>

				<div class="space-y-6 p-4 text-xs font-medium text-muted-foreground">
					{#each backofficeNavbarGroups as group (group.title)}
						{@const visibleItems = group.items.filter(canSee)}
						{#if visibleItems.length > 0}
							<div>
								<div
									class="mb-2 px-3 text-2xs font-bold tracking-wider text-muted-foreground/70 uppercase"
								>
									{group.title}
								</div>
								<div class="space-y-1">
									{#each visibleItems as item (item.label)}
										{@const Icon = item.icon}
										{#if isGroup(item)}
											{@const expanded = isExpanded(item.label, item)}
											{@const active = groupIsActive(item)}
											<button
												type="button"
												class="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors {active
													? 'bg-primary-muted text-primary'
													: 'hover:bg-muted/60'}"
												onclick={() => toggleExpanded(item.label)}
												aria-expanded={expanded}
											>
												<Icon
													class="h-4 w-4 shrink-0 {active
														? 'text-primary'
														: 'text-muted-foreground'}"
												/>
												<span class="flex-1 text-left whitespace-nowrap">{item.label}</span>
												<ChevronDown
													class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 {expanded
														? 'rotate-180'
														: ''}"
												/>
											</button>
											{#if expanded}
												<div class="mt-1 space-y-1">
													{#each item.children.filter(canSee) as child (child.label)}
														{#if isGroup(child)}
															{@const subExpanded = isExpanded(child.label, child)}
															{@const subActive = groupIsActive(child)}
															{@const SubIcon = child.icon}
															<button
																type="button"
																class="ml-4 flex min-h-11 w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-4 py-3 transition-colors {subActive
																	? 'bg-primary-muted text-primary'
																	: 'hover:bg-muted/60'}"
																onclick={() => toggleExpanded(child.label)}
																aria-expanded={subExpanded}
															>
																<SubIcon
																	class="h-4 w-4 shrink-0 {subActive
																		? 'text-primary'
																		: 'text-muted-foreground'}"
																/>
																<span class="flex-1 text-left whitespace-nowrap">{child.label}</span
																>
																<ChevronDown
																	class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 {subExpanded
																		? 'rotate-180'
																		: ''}"
																/>
															</button>
															{#if subExpanded}
																<div class="mt-1 space-y-1">
																	{#each child.children.filter(canSee) as subChild (subChild.label)}
																		{@const subChildActive = isActive(subChild.href)}
																		{@const SubChildIcon = subChild.icon}
																		{#if subChild.href}
																			<a
																				href={subChild.href}
																				class="ml-8 flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 transition-colors {subChildActive
																					? 'bg-primary font-semibold text-primary-foreground'
																					: 'hover:bg-muted/60'}"
																				onclick={closeMobileMenu}
																				aria-current={subChildActive ? 'page' : undefined}
																			>
																				<SubChildIcon
																					class="h-4 w-4 shrink-0 {subChildActive
																						? 'text-primary-foreground'
																						: 'text-muted-foreground'}"
																				/>
																				<span class="whitespace-nowrap">{subChild.label}</span>
																			</a>
																		{:else}
																			<span
																				class="ml-8 flex min-h-11 cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-muted-foreground opacity-50"
																				aria-disabled="true"
																			>
																				<SubChildIcon
																					class="h-4 w-4 shrink-0 text-muted-foreground"
																				/>
																				<span class="whitespace-nowrap">{subChild.label}</span>
																			</span>
																		{/if}
																	{/each}
																</div>
															{/if}
														{:else}
															{@const childActive = isActive(child.href)}
															{@const ChildIcon = child.icon}
															{#if child.href}
																<a
																	href={child.href}
																	class="ml-4 flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 transition-colors {childActive
																		? 'bg-primary font-semibold text-primary-foreground'
																		: 'hover:bg-muted/60'}"
																	onclick={closeMobileMenu}
																	aria-current={childActive ? 'page' : undefined}
																>
																	<ChildIcon
																		class="h-4 w-4 shrink-0 {childActive
																			? 'text-primary-foreground'
																			: 'text-muted-foreground'}"
																	/>
																	<span class="whitespace-nowrap">{child.label}</span>
																</a>
															{:else}
																<span
																	class="ml-4 flex min-h-11 cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-muted-foreground opacity-50"
																	aria-disabled="true"
																>
																	<ChildIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
																	<span class="whitespace-nowrap">{child.label}</span>
																</span>
															{/if}
														{/if}
													{/each}
												</div>
											{/if}
										{:else}
											{@const active = isActive(item.href)}
											{#if item.href}
												<a
													href={item.href}
													class="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 transition-colors {active
														? 'bg-primary font-semibold text-primary-foreground'
														: 'hover:bg-muted/60'}"
													onclick={closeMobileMenu}
													aria-current={active ? 'page' : undefined}
												>
													<Icon
														class="h-4 w-4 shrink-0 {active
															? 'text-primary-foreground'
															: 'text-muted-foreground'}"
													/>
													<span class="whitespace-nowrap">{item.label}</span>
												</a>
											{:else}
												<span
													class="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-muted-foreground opacity-50"
													aria-disabled="true"
												>
													<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
													<span class="whitespace-nowrap">{item.label}</span>
												</span>
											{/if}
										{/if}
									{/each}
								</div>
							</div>
						{/if}
					{/each}
				</div>
			</div>

			<Sheet.Footer class="border-t border-sidebar-border bg-card p-4">
				<div class="flex flex-col gap-2">
					<span
						class="max-w-full self-start truncate rounded-lg border border-primary/10 bg-primary/5 px-2 py-1 text-2xs font-medium text-primary"
						title={formatRoleList(roles)}
					>
						{formatRoleList(roles)}
					</span>
					<StaffAccountMenu class="w-full" side="top" align="start" onNavigate={closeMobileMenu} />
				</div>
			</Sheet.Footer>
		</Sheet.Content>
	</Sheet.Root>
</div>

<style>
	.no-scrollbar {
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
</style>
