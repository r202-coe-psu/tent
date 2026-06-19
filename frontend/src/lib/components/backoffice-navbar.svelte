<script lang="ts">
	import { page } from '$app/state';
	import House from '@lucide/svelte/icons/house';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import {
		backofficeNavbarGroups,
		backofficeHomePath,
		isGroup,
		type BackofficeNavbarNode
	} from './backoffice-navbar/static';

	let collapsed = $state(false);

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
	class="relative flex min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-card text-foreground transition-[width] duration-200 {collapsed
		? 'w-16'
		: 'w-72'}"
>
	<div class="flex items-center justify-between border-b border-sidebar-border p-5">
		<a href={backofficeHomePath} class="flex items-center gap-3" aria-label="กลับหน้าเลือกเมนูหลัก">
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
			class="absolute top-6 -right-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-card text-xs text-muted-foreground shadow-sm hover:bg-muted"
			onclick={() => (collapsed = !collapsed)}
			aria-label={collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
		>
			<ChevronLeft class="h-3 w-3" />
		</button>
	</div>

	<div class="no-scrollbar flex-1 overflow-y-auto">
		<div class="space-y-6 p-4 text-[13px] font-medium text-muted-foreground">
			<a
				href={backofficeHomePath}
				class="flex w-full items-center justify-center gap-2 rounded-xl bg-muted px-4 py-2.5 text-sm font-normal text-foreground transition-colors hover:bg-muted/70"
				title="กลับหน้าเลือกเมนูหลัก"
			>
				<House class="h-3.5 w-3.5 text-muted-foreground" />
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
</aside>

<style>
	.no-scrollbar {
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
</style>
