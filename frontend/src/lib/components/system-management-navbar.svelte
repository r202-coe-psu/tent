<script lang="ts">
	import { page } from '$app/state';
	import House from '@lucide/svelte/icons/house';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { LOGOUT_ROUTE } from '$lib/guards/auth';
	import { isSystemAdmin, formatRoleList } from '$lib/auth/roles';
	import {
		systemManagementNavbarGroups,
		systemManagementHomePath,
		isGroup,
		type SystemManagementNavbarNode
	} from './system-management-navbar/static';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	let collapsed = $state(false);
	let mobileMenuOpen = $state(false);

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));

	async function logout() {
		mobileMenuOpen = false;
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve(LOGOUT_ROUTE));
	}

	function normalize(path: string): string {
		return path.replace(/\/$/, '');
	}

	function isActive(href: SystemManagementNavbarNode['href']): boolean {
		if (!href) return false;
		const path = normalize(page.url.pathname);
		const target = normalize(String(href));
		return path === target || path.startsWith(target + '/');
	}

	function groupIsActive(node: SystemManagementNavbarNode): boolean {
		return isGroup(node) && node.children.some((child) => isActive(child.href));
	}

	const expandedKeys = $derived(
		new Set(
			systemManagementNavbarGroups
				.flatMap((group) => group.items)
				.filter(groupIsActive)
				.map((node) => (node as { label: string }).label)
		)
	);

	let manualOverrides = $state<Record<string, boolean>>({});

	function isExpanded(label: string, node: SystemManagementNavbarNode): boolean {
		if (label in manualOverrides) return manualOverrides[label];
		return expandedKeys.has(label) || groupIsActive(node);
	}

	function toggleExpanded(label: string) {
		const node = systemManagementNavbarGroups
			.flatMap((group) => group.items)
			.find((item) => item.label === label);
		if (node) manualOverrides[label] = !isExpanded(label, node);
	}

	function canSee(node: SystemManagementNavbarNode): boolean {
		return !node.requiresAdmin || isSA;
	}
</script>

<aside
	class="relative hidden min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-card text-foreground transition-[width] duration-200 md:flex {collapsed
		? 'w-16'
		: 'w-72'}"
>
	<Tooltip.Provider delayDuration={150}>
		<div
			class="sticky top-0 z-20 flex items-center bg-card {collapsed
				? 'justify-center px-2 py-5'
				: 'justify-between gap-2 p-5'}"
		>
			<a
				href={systemManagementHomePath}
				class="flex items-center gap-3 {collapsed ? 'flex-none justify-center' : 'flex-1'}"
				aria-label="กลับหน้าระบบส่วนกลาง"
			>
				<div
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground"
				>
					SS
				</div>
				{#if !collapsed}
					<span class="text-xl font-bold tracking-tight text-foreground">
						Smart<span class="text-primary">Shelter</span>
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
				{#if collapsed}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<a
									{...props}
									href={resolve('/portal')}
									class="flex h-10 w-full items-center justify-center rounded-xl bg-muted text-sm font-normal text-foreground transition-colors hover:bg-muted/70"
									aria-label="กลับหน้าเลือกเมนูหลัก"
								>
									<House class="h-4 w-4 shrink-0 text-muted-foreground" />
								</a>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right" sideOffset={8}>กลับหน้าเลือกเมนูหลัก</Tooltip.Content>
					</Tooltip.Root>
				{:else}
					<a
						href={resolve('/portal')}
						class="flex w-full items-center justify-center gap-2 rounded-xl bg-muted px-4 py-2.5 text-sm font-normal text-foreground transition-colors hover:bg-muted/70"
						title="กลับหน้าเลือกเมนูหลัก"
					>
						<House class="h-4 w-4 shrink-0 text-muted-foreground" />
						<span>กลับหน้าเลือกเมนูหลัก</span>
					</a>
				{/if}
			</div>

			<div class="space-y-6 px-4 pt-2 pb-4 text-xs font-medium text-muted-foreground">
				{#each systemManagementNavbarGroups as group (group.title)}
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
										{#if collapsed}
											<DropdownMenu.Root>
												<DropdownMenu.Trigger>
													{#snippet child({ props })}
														<button
															{...props}
															type="button"
															class="flex h-10 w-full items-center justify-center rounded-xl transition-colors {active
																? 'bg-primary-muted text-primary'
																: 'text-muted-foreground hover:bg-muted/60'}"
															aria-label={item.label}
														>
															<Icon
																class="h-4 w-4 shrink-0 {active
																	? 'text-primary'
																	: 'text-muted-foreground'}"
															/>
														</button>
													{/snippet}
												</DropdownMenu.Trigger>
												<DropdownMenu.Content
													side="right"
													align="start"
													sideOffset={8}
													class="w-60 p-1.5 shadow-md"
												>
													<DropdownMenu.Label
														class="px-2.5 py-1.5 text-xs font-bold text-foreground"
													>
														{item.label}
													</DropdownMenu.Label>
													<DropdownMenu.Separator />
													{#each item.children.filter(canSee) as child (child.label)}
														{@const childActive = isActive(child.href)}
														{@const ChildIcon = child.icon}
														{#if child.href}
															<DropdownMenu.Item
																onSelect={() => child.href && goto(child.href)}
																class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors {childActive
																	? 'bg-primary font-semibold text-primary-foreground'
																	: 'text-foreground hover:bg-muted'}"
															>
																<ChildIcon
																	class="h-3.5 w-3.5 shrink-0 {childActive
																		? 'text-primary-foreground'
																		: 'text-muted-foreground'}"
																/>
																<span class="truncate">{child.label}</span>
															</DropdownMenu.Item>
														{:else}
															<DropdownMenu.Item
																disabled
																class="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-muted-foreground opacity-50"
															>
																<ChildIcon class="h-3.5 w-3.5 shrink-0" />
																<span class="truncate">{child.label}</span>
															</DropdownMenu.Item>
														{/if}
													{/each}
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										{:else}
											<button
												type="button"
												class="flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors {active
													? 'bg-primary-muted text-primary'
													: 'hover:bg-muted/60'}"
												onclick={() => toggleExpanded(item.label)}
												aria-expanded={expanded}
												title={item.label}
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
													{/each}
												</div>
											{/if}
										{/if}
									{:else if item.href}
										{@const active = isActive(item.href)}
										{#if collapsed}
											<Tooltip.Root>
												<Tooltip.Trigger>
													{#snippet child({ props })}
														<a
															{...props}
															href={item.href}
															class="flex h-10 w-full items-center justify-center rounded-xl transition-colors {active
																? 'bg-primary font-semibold text-primary-foreground'
																: 'text-muted-foreground hover:bg-muted/60'}"
															aria-current={active ? 'page' : undefined}
															aria-label={item.label}
														>
															<Icon
																class="h-4 w-4 shrink-0 {active
																	? 'text-primary-foreground'
																	: 'text-muted-foreground'}"
															/>
														</a>
													{/snippet}
												</Tooltip.Trigger>
												<Tooltip.Content side="right" sideOffset={8}>
													{item.label}
												</Tooltip.Content>
											</Tooltip.Root>
										{:else}
											<a
												href={item.href}
												class="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors {active
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
												<span class="whitespace-nowrap">{item.label}</span>
											</a>
										{/if}
									{:else if collapsed}
										<Tooltip.Root>
											<Tooltip.Trigger>
												{#snippet child({ props })}
													<span
														{...props}
														class="flex h-10 w-full cursor-not-allowed items-center justify-center rounded-xl text-muted-foreground opacity-50"
														aria-disabled="true"
														aria-label={item.label}
													>
														<Icon class="h-4 w-4 shrink-0" />
													</span>
												{/snippet}
											</Tooltip.Trigger>
											<Tooltip.Content side="right" sideOffset={8}>
												{item.label} (ยังไม่เปิดใช้งาน)
											</Tooltip.Content>
										</Tooltip.Root>
									{:else}
										<span
											class="flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-muted-foreground opacity-50"
											aria-disabled="true"
											title={item.label}
										>
											<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
											<span class="whitespace-nowrap">{item.label}</span>
										</span>
									{/if}
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>

		<div class="mt-auto border-t border-sidebar-border bg-card p-4">
			{#if collapsed}
				<div class="flex flex-col items-center gap-4">
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<div
									{...props}
									class="flex h-9 w-9 cursor-default items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
								>
									{authStore.user?.name?.substring(0, 2).toUpperCase() || 'US'}
								</div>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right" sideOffset={8}>
							{authStore.user?.name} ({formatRoleList(roles)})
						</Tooltip.Content>
					</Tooltip.Root>

					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="flex h-9 w-9 items-center justify-center rounded-xl border border-destructive/20 text-destructive transition-colors hover:bg-destructive/10 active:scale-95"
									onclick={logout}
									aria-label="ออกจากระบบ"
								>
									<LogOut class="h-4 w-4" />
								</button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right" sideOffset={8}>ออกจากระบบ</Tooltip.Content>
					</Tooltip.Root>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-normal text-muted-foreground">เข้าสู่ระบบโดย</span>
						<span class="truncate text-sm font-bold text-foreground" title={authStore.user?.name}
							>{authStore.user?.name}</span
						>
						<span
							class="mt-1 max-w-full self-start truncate rounded-lg border border-primary/10 bg-primary/5 px-2 py-1 text-2xs font-medium text-primary"
							title={formatRoleList(roles)}
						>
							{formatRoleList(roles)}
						</span>
					</div>
					<button
						type="button"
						class="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/20 px-4 py-2.5 text-sm font-medium text-destructive transition-all hover:bg-destructive/10 active:scale-95"
						onclick={logout}
					>
						<LogOut class="h-4 w-4" />
						<span>ออกจากระบบ</span>
					</button>
				</div>
			{/if}
		</div>
	</Tooltip.Provider>
</aside>

<div class="relative z-50 w-full shrink-0 border-b border-sidebar-border bg-card md:hidden">
	<div class="flex h-16 w-full items-center justify-between px-4">
		<a
			href={systemManagementHomePath}
			class="flex items-center gap-3"
			onclick={() => (mobileMenuOpen = false)}
		>
			<div
				class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground"
			>
				SS
			</div>
			<span class="text-lg font-bold tracking-tight text-foreground">
				Smart<span class="text-primary">Shelter</span>
				<span class="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-2xs font-semibold text-primary">
					System Management
				</span>
			</span>
		</a>
		<button
			type="button"
			class="flex h-10 w-10 items-center justify-center rounded-lg border border-sidebar-border bg-card text-muted-foreground shadow-sm transition-all hover:bg-muted active:scale-95"
			onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			aria-label={mobileMenuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
		>
			{#if mobileMenuOpen}<X class="h-5 w-5" />{:else}<Menu class="h-5 w-5" />{/if}
		</button>
	</div>

	{#if mobileMenuOpen}
		<div
			class="absolute top-16 right-0 left-0 z-40 max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-sidebar-border bg-card p-4 shadow-xl"
			transition:slide={{ duration: 200 }}
		>
			<!-- Return to Portal Hub Button on Mobile -->
			<a
				href={resolve('/portal')}
				class="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-muted py-2.5 text-sm font-normal text-foreground transition-colors hover:bg-muted/70"
				onclick={() => (mobileMenuOpen = false)}
			>
				<House class="h-4 w-4 shrink-0 text-muted-foreground" />
				<span>กลับหน้าเลือกเมนูหลัก</span>
			</a>

			<div class="space-y-6">
				{#each systemManagementNavbarGroups as group (group.title)}
					{@const visibleItems = group.items.filter(canSee)}
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
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors {groupIsActive(
											item
										)
											? 'bg-primary-muted text-primary'
											: 'hover:bg-muted/60'}"
										onclick={() => toggleExpanded(item.label)}
										aria-expanded={expanded}
									>
										<Icon class="h-4 w-4 shrink-0" />
										<span class="flex-1 text-left whitespace-nowrap">{item.label}</span>
										<ChevronDown class="h-3.5 w-3.5 {expanded ? 'rotate-180' : ''}" />
									</button>
									{#if expanded}
										<div class="mt-1 space-y-1">
											{#each item.children.filter(canSee) as child (child.label)}
												{@const childActive = isActive(child.href)}
												{@const ChildIcon = child.icon}
												{#if child.href}
													<a
														href={child.href}
														class="ml-4 flex items-center gap-3 rounded-xl px-4 py-2.5 {childActive
															? 'bg-primary font-semibold text-primary-foreground'
															: 'hover:bg-muted/60'}"
														onclick={() => (mobileMenuOpen = false)}
													>
														<ChildIcon class="h-4 w-4 shrink-0" />
														<span class="whitespace-nowrap">{child.label}</span>
													</a>
												{:else}
													<span
														class="ml-4 flex items-center gap-3 rounded-xl px-4 py-2.5 text-muted-foreground opacity-50"
													>
														<ChildIcon class="h-4 w-4 shrink-0" />
														<span class="whitespace-nowrap">{child.label}</span>
													</span>
												{/if}
											{/each}
										</div>
									{/if}
								{:else if item.href}
									{@const active = isActive(item.href)}
									<a
										href={item.href}
										class="flex items-center gap-3 rounded-xl px-4 py-3 {active
											? 'bg-primary font-semibold text-primary-foreground'
											: 'hover:bg-muted/60'}"
										onclick={() => (mobileMenuOpen = false)}
									>
										<Icon class="h-4 w-4 shrink-0" />
										<span class="whitespace-nowrap">{item.label}</span>
									</a>
								{/if}
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<!-- Mobile User Profile & Logout Section -->
			<div class="mt-6 border-t border-sidebar-border pt-4">
				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-normal text-muted-foreground">เข้าสู่ระบบโดย</span>
						<span class="truncate text-sm font-bold text-foreground" title={authStore.user?.name}>
							{authStore.user?.name}
						</span>
						<span
							class="mt-1 max-w-full self-start truncate rounded-lg border border-primary/10 bg-primary/5 px-2 py-1 text-2xs font-medium text-primary"
							title={formatRoleList(roles)}
						>
							{formatRoleList(roles)}
						</span>
					</div>
					<button
						type="button"
						class="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/20 px-4 py-2.5 text-sm font-medium text-destructive transition-all hover:bg-destructive/10 active:scale-95"
						onclick={logout}
					>
						<LogOut class="h-4 w-4" />
						<span>ออกจากระบบ</span>
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
