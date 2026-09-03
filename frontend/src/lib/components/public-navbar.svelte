<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Home from '@lucide/svelte/icons/home';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import Heart from '@lucide/svelte/icons/heart';
	import PackageSearch from '@lucide/svelte/icons/package-search';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Globe from '@lucide/svelte/icons/globe';

	import * as Select from '$lib/components/ui/select';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_NAVBAR_I18N, SUPPORTED_LANGUAGES } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	function isActive(path: string) {
		if (path === '/') {
			return page.url.pathname === '/';
		}
		return page.url.pathname.startsWith(path);
	}

	function isHomePage() {
		return page.url.pathname === '/';
	}

	function isDonatePage() {
		const p = page.url.pathname;
		return p === '/donations' || p === '/donations/';
	}

	function isTrackPage() {
		return page.url.pathname.startsWith('/donations/track');
	}

	function isDonationsSection() {
		return isDonatePage() || isTrackPage();
	}

	let mobileMenuOpen = $state(false);
	let donationsMenuOpen = $state(false);
	let donationsMenuEl: HTMLDivElement | undefined = $state();

	const t = $derived(getTranslation(PUBLIC_NAVBAR_I18N, langState.current));

	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
	}

	function toggleDonationsMenu() {
		donationsMenuOpen = !donationsMenuOpen;
	}

	function closeDonationsMenu() {
		donationsMenuOpen = false;
	}

	function handleWindowPointerDown(event: PointerEvent) {
		const target = event.target as Node;
		if (donationsMenuOpen && donationsMenuEl && !donationsMenuEl.contains(target)) {
			closeDonationsMenu();
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		closeDonationsMenu();
	}

	afterNavigate(() => {
		donationsMenuOpen = false;
		mobileMenuOpen = false;
	});
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<header
	class="sticky top-0 z-50 w-full border-b border-border bg-card/95 px-6 py-3 shadow-xs backdrop-blur-md"
>
	<div class="mx-auto flex max-w-7xl items-center justify-between">
		<!-- Logo and Title -->
		<div class="flex items-center gap-3">
			<a href={resolve('/')} class="flex items-center gap-2">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted text-primary"
				>
					<Compass class="h-5 w-5" />
				</div>
				<div class="flex flex-col">
					<span class="text-base font-bold tracking-tight text-foreground">{t.appTitle}</span>
					<span class="text-2xs font-semibold tracking-wider text-primary uppercase"
						>{t.appSubtitle}</span
					>
				</div>
			</a>
		</div>

		<!-- Mobile Menu Button -->
		<div class="flex items-center gap-2 md:hidden">
			<!-- Language Switcher (Mobile) -->
			<Select.Root
				type="single"
				value={langState.current}
				onValueChange={(v) => {
					if (v) langState.current = v;
				}}
			>
				<Select.Trigger
					class="h-8 w-[60px] border-none bg-transparent px-2 text-xs shadow-none focus:ring-0"
				>
					{langState.current.toUpperCase()}
				</Select.Trigger>
				<Select.Content>
					{#each SUPPORTED_LANGUAGES as lang (lang.code)}
						<Select.Item value={lang.code} label={lang.name}>
							<div class="flex items-center gap-2">
								<span class="text-sm">{lang.name}</span>
							</div>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>

			<button
				class="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
				onclick={toggleMobileMenu}
				aria-label="Toggle mobile menu"
			>
				{#if mobileMenuOpen}
					<X class="h-6 w-6" />
				{:else}
					<Menu class="h-6 w-6" />
				{/if}
			</button>
		</div>

		<!-- Navbar Links -->
		<nav class="hidden items-center gap-1 md:flex">
			<a
				href={resolve('/')}
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isHomePage()
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Home class="h-4 w-4" />
				{t.home}
			</a>

			<a
				href={resolve('/shelters')}
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
					'/shelters'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Compass class="h-4 w-4" />
				{t.shelters}
			</a>

			<a
				href={resolve('/search')}
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
					'/search'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Search class="h-4 w-4" />
				{t.search}
			</a>

			<a
				href={resolve('/pre-register')}
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
					'/pre-register'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<ClipboardCheck class="h-4 w-4" />
				ลงทะเบียนล่วงหน้า
			</a>

			<!-- Donations: donate + track (CR-052 §2.6) — click toggle (not hover) -->
			<div class="relative" bind:this={donationsMenuEl}>
				<button
					type="button"
					onclick={toggleDonationsMenu}
					aria-haspopup="menu"
					aria-expanded={donationsMenuOpen}
					aria-controls={donationsMenuOpen ? 'donations-menu' : undefined}
					class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isDonationsSection() ||
					donationsMenuOpen
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Heart class="h-4 w-4" />
					{t.donate}
					<ChevronDown
						class="h-3.5 w-3.5 text-muted-foreground/75 transition-transform {donationsMenuOpen
							? 'rotate-180'
							: ''}"
					/>
				</button>
				{#if donationsMenuOpen}
					<div
						id="donations-menu"
						role="menu"
						class="absolute right-0 mt-1 w-52 rounded-xl border border-border bg-card p-1 shadow-sm"
					>
						<a
							role="menuitem"
							href={resolve('/donations')}
							onclick={closeDonationsMenu}
							class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground {isDonatePage()
								? 'bg-primary-muted text-primary'
								: 'text-muted-foreground'}"
						>
							<Heart class="h-3.5 w-3.5" />
							{t.donateAndBook}
						</a>
						<a
							role="menuitem"
							href={resolve('/donations/track')}
							onclick={closeDonationsMenu}
							class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground {isTrackPage()
								? 'bg-primary-muted text-primary'
								: 'text-muted-foreground'}"
						>
							<PackageSearch class="h-3.5 w-3.5" />
							{t.trackDonation}
						</a>
					</div>
				{/if}
			</div>

			<a
				href={resolve('/login')}
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 {isActive(
					'/login'
				)
					? 'bg-primary-muted text-primary'
					: ''}"
			>
				<Building2 class="h-4 w-4" />
				{t.backoffice}
			</a>

			<div class="ml-2 flex items-center border-l border-border pl-3">
				<Globe class="mr-1 h-4 w-4 text-muted-foreground" />
				<Select.Root
					type="single"
					value={langState.current}
					onValueChange={(v) => {
						if (v) langState.current = v;
					}}
				>
					<Select.Trigger
						class="h-8 w-[80px] border-none bg-transparent px-2 text-sm shadow-none focus:ring-0"
					>
						{SUPPORTED_LANGUAGES.find((l) => l.code === langState.current)?.name ||
							langState.current.toUpperCase()}
					</Select.Trigger>
					<Select.Content>
						{#each SUPPORTED_LANGUAGES as lang (lang.code)}
							<Select.Item value={lang.code} label={lang.name}>
								<div class="flex items-center gap-2">
									<span class="text-sm">{lang.name}</span>
								</div>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</nav>
	</div>

	<!-- Mobile Menu Dropdown -->
	{#if mobileMenuOpen}
		<div class="absolute top-full left-0 w-full border-b border-border bg-card shadow-lg md:hidden">
			<nav class="flex flex-col gap-2 p-4">
				<a
					href={resolve('/')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isHomePage()
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Home class="h-5 w-5" />
					{t.home}
				</a>

				<a
					href={resolve('/shelters')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
						'/shelters'
					)
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Compass class="h-5 w-5" />
					{t.shelters}
				</a>

				<a
					href={resolve('/search')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
						'/search'
					)
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Search class="h-5 w-5" />
					{t.search}
				</a>

				<a
					href={resolve('/pre-register')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
						'/pre-register'
					)
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<ClipboardCheck class="h-5 w-5" />
					ลงทะเบียนล่วงหน้า
				</a>

				<a
					href={resolve('/donations')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isDonatePage()
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Heart class="h-5 w-5" />
					{t.donateAndBook}
				</a>

				<a
					href={resolve('/donations/track')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isTrackPage()
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<PackageSearch class="h-5 w-5" />
					{t.trackDonationLong}
				</a>

				<a
					href={resolve('/login')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 {isActive(
						'/login'
					)
						? 'bg-primary-muted text-primary'
						: ''}"
				>
					<Building2 class="h-5 w-5" />
					{t.backoffice}
				</a>
			</nav>
		</div>
	{/if}
</header>
