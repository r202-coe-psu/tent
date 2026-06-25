<script lang="ts">
	import { page } from '$app/state';
	import House from '@lucide/svelte/icons/house';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Building from '@lucide/svelte/icons/building';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { LOGIN_ROUTE } from '$lib/guards/auth';
	import { isShelterManager, isSystemAdmin, formatRoleList } from '$lib/auth/roles';
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
	const canManageUsers = $derived(isSA || isShelterManager(roles));

	async function logout() {
		mobileMenuOpen = false;
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve(LOGIN_ROUTE));
	}

	function normalize(path: string): string {
		return path.replace(/\/$/, '');
	}

	function isActive(href: BackofficeNavbarNode['href']): boolean {
		if (!href) return false;
		const path = normalize(page.url.pathname);
		const target = normalize(String(href));
		return path === target || path.startsWith(target + '/');
	}

	function groupIsActive(node: BackofficeNavbarNode): boolean {
		if (!isGroup(node)) return false;
		return node.children.some((c) => isActive(c.href));
	}

	const expandedKeys = $derived(
		new Set(
			backofficeNavbarGroups
				.flatMap((g) => g.items)
				.filter(groupIsActive)
				.map((n) => (n as { label: string }).label)
		)
	);

	let manualOverrides = $state<Record<string, boolean>>({});

	function isExpanded(label: string, node: BackofficeNavbarNode): boolean {
		if (label in manualOverrides) return manualOverrides[label];
		return expandedKeys.has(label) || groupIsActive(node);
	}

	function toggleExpanded(label: string) {
		const node = backofficeNavbarGroups
			.flatMap((g) => g.items)
			.find((n) => 'label' in n && n.label === label);
		if (!node) return;
		manualOverrides[label] = !isExpanded(label, node);
	}
</script>

<aside
	class="relative hidden min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-card text-foreground transition-[width] duration-200 md:flex {collapsed
		? 'w-16'
		: 'w-72'}"
>
	<div class="sticky top-0 z-20 flex items-center bg-card {collapsed ? 'px-2 py-5 justify-center' : 'p-5 justify-between gap-2'}">
		<a
			href={backofficeHomePath}
			class="flex items-center gap-3 {collapsed ? 'justify-center flex-none' : 'flex-1'}"
			aria-label="กลับหน้าเลือกเมนูหลัก"
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
			class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-card text-xs text-muted-foreground shadow-sm hover:bg-muted {collapsed ? 'absolute -right-3 top-6 z-30' : ''}"
			onclick={() => (collapsed = !collapsed)}
			aria-label={collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
		>
			<ChevronLeft class="h-3 w-3 transition-transform {collapsed ? 'rotate-180' : ''}" />
		</button>
	</div>

	<div class="no-scrollbar flex-1 overflow-y-auto">
		<div class="space-y-6 p-4 text-[13px] font-medium text-muted-foreground">
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

			{#each backofficeNavbarGroups as group (group.title)}
				<div>
					{#if !collapsed}
						<div
							class="mb-2 px-3 text-[11px] font-bold tracking-wider text-muted-foreground/70 uppercase"
						>
							{group.title}
						</div>
					{/if}
					<div class="space-y-1">
						{#each group.items as item (item.label)}
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
										{#each item.children as child (child.label)}
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
			{/each}
		</div>
	</div>

	<!-- Desktop Sidebar Footer (User Profile & Logout) -->
	<div class="mt-auto border-t border-sidebar-border bg-card p-4">
		{#if collapsed}
			<div class="flex flex-col items-center gap-4">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
					title="{authStore.user?.name} ({formatRoleList(roles)})"
				>
					{authStore.user?.name?.substring(0, 2).toUpperCase() || 'US'}
				</div>
				<button
					type="button"
					class="flex h-9 w-9 items-center justify-center rounded-xl border border-destructive/20 text-destructive transition-colors hover:bg-destructive/10 active:scale-95"
					onclick={logout}
					title="ออกจากระบบ"
				>
					<LogOut class="h-4 w-4" />
				</button>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-0.5">
					<span class="text-xs font-normal text-muted-foreground">เข้าสู่ระบบโดย</span>
					<span class="truncate text-sm font-bold text-foreground" title={authStore.user?.name}
						>{authStore.user?.name}</span
					>
					<span
						class="mt-1 max-w-full self-start truncate rounded-lg border border-primary/10 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary"
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
</aside>

<!-- Mobile Navigation Wrapper -->
<div class="relative z-50 w-full shrink-0 border-b border-sidebar-border bg-card md:hidden">
	<!-- Mobile Top Bar -->
	<div class="flex h-16 w-full items-center justify-between px-4">
		<a
			href={backofficeHomePath}
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
				<span
					class="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
				>
					Back-Office
				</span>
			</span>
		</a>

		<button
			type="button"
			class="flex h-10 w-10 items-center justify-center rounded-lg border border-sidebar-border bg-card text-muted-foreground shadow-sm transition-all hover:bg-muted active:scale-95"
			onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			aria-label={mobileMenuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
		>
			{#if mobileMenuOpen}
				<X class="h-5 w-5" />
			{:else}
				<Menu class="h-5 w-5" />
			{/if}
		</button>
	</div>

	<!-- Mobile Dropdown Menu -->
	{#if mobileMenuOpen}
		<div
			class="absolute top-16 right-0 left-0 z-40 max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-sidebar-border bg-card shadow-xl"
			transition:slide={{ duration: 200 }}
		>
			<!-- Global Navigation Links (App, People, Shelters, Users) -->

			<!-- Back-Office Menu Groups -->
			<div class="space-y-6 p-4">
				{#each backofficeNavbarGroups as group (group.title)}
					<div>
						<div
							class="mb-2 px-3 text-[11px] font-bold tracking-wider text-muted-foreground/70 uppercase"
						>
							{group.title}
						</div>
						<div class="space-y-1">
							{#each group.items as item (item.label)}
								{@const Icon = item.icon}
								{#if isGroup(item)}
									{@const expanded = isExpanded(item.label, item)}
									{@const active = groupIsActive(item)}
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors {active
											? 'bg-primary-muted text-primary'
											: 'hover:bg-muted/60'}"
										onclick={() => toggleExpanded(item.label)}
										aria-expanded={expanded}
									>
										<Icon
											class="h-4 w-4 shrink-0 {active ? 'text-primary' : 'text-muted-foreground'}"
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
											{#each item.children as child (child.label)}
												{@const childActive = isActive(child.href)}
												{@const ChildIcon = child.icon}
												{#if child.href}
													<a
														href={child.href}
														class="ml-4 flex items-center gap-3 rounded-xl px-4 py-2.5 transition-colors {childActive
															? 'bg-primary font-semibold text-primary-foreground'
															: 'hover:bg-muted/60'}"
														onclick={() => (mobileMenuOpen = false)}
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
														class="ml-4 flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-2.5 text-muted-foreground opacity-50"
														aria-disabled="true"
													>
														<ChildIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
														<span class="whitespace-nowrap">{child.label}</span>
													</span>
												{/if}
											{/each}
										</div>
									{/if}
								{:else}
									{@const active = isActive(item.href)}
									{#if item.href}
										<a
											href={item.href}
											class="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors {active
												? 'bg-primary font-semibold text-primary-foreground'
												: 'hover:bg-muted/60'}"
											onclick={() => (mobileMenuOpen = false)}
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
											class="flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-muted-foreground opacity-50"
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
				{/each}
			</div>

			<!-- User Profile & Logout inside dropdown -->
			<div class="flex items-center justify-between border-t border-sidebar-border bg-muted/20 p-4">
				<div class="flex max-w-[65%] flex-col gap-1">
					<span class="text-[10px] font-medium tracking-wider text-muted-foreground uppercase"
						>ลงชื่อเข้าใช้โดย</span
					>
					<span class="truncate text-sm font-bold text-foreground" title={authStore.user?.name}
						>{authStore.user?.name}</span
					>
					<span
						class="max-w-full self-start truncate rounded-lg border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
						title={formatRoleList(roles)}
					>
						{formatRoleList(roles)}
					</span>
				</div>
				<button
					type="button"
					class="flex items-center gap-2 rounded-xl border border-destructive/20 px-4 py-2.5 text-sm font-medium text-destructive transition-all hover:bg-destructive/10 active:scale-95"
					onclick={logout}
				>
					<LogOut class="h-4 w-4" />
					<span>ออกจากระบบ</span>
				</button>
			</div>
		</div>
	{/if}
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
