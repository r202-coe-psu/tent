<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Home from '@lucide/svelte/icons/home';
	import Building from '@lucide/svelte/icons/building';
	import Search from '@lucide/svelte/icons/search';
	import Heart from '@lucide/svelte/icons/heart';
	import Package from '@lucide/svelte/icons/package';
	import ClipboardPenLine from '@lucide/svelte/icons/clipboard-pen-line';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Menu from '@lucide/svelte/icons/menu';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Lock from '@lucide/svelte/icons/lock';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Bell from '@lucide/svelte/icons/bell';
	// import Users from '@lucide/svelte/icons/users'; // Volunteer link temporarily disabled

	// import * as Select from '$lib/components/ui/select';
	import * as Sheet from '$lib/components/ui/sheet';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_NAVBAR_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import type { Announcement } from '$lib/features/announcements';
	import PublicNotificationMenu from '$lib/components/public-notification-menu.svelte';

	interface Props {
		announcements?: Announcement[];
	}

	let { announcements: propAnnouncements = [] }: Props = $props();

	const announcements = $derived(propAnnouncements);
	const announcementsCount = $derived(announcements.length);

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
	let volunteersMenuOpen = $state(false);
	let volunteersMenuEl: HTMLDivElement | undefined = $state();
	let alertsMenuOpen = $state(false);
	let desktopAlertsOpen = $state(false);
	let headerHeight = $state(64);

	const t = $derived(getTranslation(PUBLIC_NAVBAR_I18N, langState.current));

	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
		if (mobileMenuOpen) {
			alertsMenuOpen = false;
			desktopAlertsOpen = false;
			donationsMenuOpen = false;
		}
	}

	function closeMobileMenu() {
		mobileMenuOpen = false;
	}

	function toggleDonationsMenu() {
		donationsMenuOpen = !donationsMenuOpen;
		if (donationsMenuOpen) {
			alertsMenuOpen = false;
			desktopAlertsOpen = false;
		}
	}

	function closeDonationsMenu() {
		donationsMenuOpen = false;
	}

	function toggleLanguage() {
		langState.current = langState.current === 'th' ? 'en' : 'th';
	}

	function handleWindowPointerDown(event: PointerEvent) {
		const target = event.target as Node;
		if (donationsMenuOpen && donationsMenuEl && !donationsMenuEl.contains(target)) {
			closeDonationsMenu();
		}
		if (volunteersMenuOpen && volunteersMenuEl && !volunteersMenuEl.contains(target)) {
			volunteersMenuOpen = false;
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		closeDonationsMenu();
		volunteersMenuOpen = false;
	}

	afterNavigate(() => {
		donationsMenuOpen = false;
		volunteersMenuOpen = false;
		mobileMenuOpen = false;
		alertsMenuOpen = false;
		desktopAlertsOpen = false;
	});
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<header
	bind:clientHeight={headerHeight}
	class="fixed top-0 right-0 left-0 z-50 w-full border-b border-border bg-card/95 px-3 py-2.5 shadow-xs backdrop-blur-md sm:px-6 sm:py-3"
>
	<div
		class="relative z-50 mx-auto flex max-w-7xl flex-nowrap items-center justify-between gap-2 sm:gap-3"
	>
		<!-- Logo and Title -->
		<div class="flex min-w-0 shrink items-center gap-2">
			<a href={resolve('/')} class="flex min-w-0 items-center gap-2 sm:gap-2.5">
				<img
					src="/logo.png"
					alt="PSU Smart Shelter"
					class="h-8 w-8 shrink-0 rounded-lg object-contain sm:h-9 sm:w-9"
				/>
				<span class="truncate text-sm font-bold tracking-tight text-foreground sm:text-base"
					>PSU Smart Shelter</span
				>
			</a>
		</div>

		<!-- Compact controls: phone + tablet + iPad Pro mid-range (hamburger through xl) -->
		<div class="flex shrink-0 items-center gap-1 sm:gap-2 xl:hidden">
			<!-- Notification Bell Button (Mobile) -->
			<PublicNotificationMenu variant="navbar" {announcements} bind:menuOpen={alertsMenuOpen} />

			<!-- Language Switcher (Mobile) -->
			<div class="flex shrink-0 items-center border-l border-slate-200 pl-1.5 sm:pl-2">
				<button
					type="button"
					onclick={toggleLanguage}
					class="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-bold text-[#0A2647] shadow-2xs transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-95"
					aria-label={langState.current === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
				>
					{langState.current === 'th' ? 'EN' : 'TH'}
				</button>
			</div>

			<button
				type="button"
				class="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
				onclick={toggleMobileMenu}
				aria-label={mobileMenuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
				aria-expanded={mobileMenuOpen}
				aria-controls="public-mobile-nav"
			>
				<Menu class="h-6 w-6" />
			</button>
		</div>

		<!-- Full horizontal nav: desktop xl+ only (hamburger through tablet + iPad Pro mid-range) -->
		<nav class="hidden flex-nowrap items-center gap-0.5 xl:flex 2xl:gap-1">
			<a
				href={resolve('/')}
				class="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 2xl:gap-2 2xl:px-3 {isHomePage()
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Home class="h-4 w-4" />
				{t.home}
			</a>

			<a
				href={resolve('/shelters')}
				class="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 2xl:gap-2 2xl:px-3 {isActive(
					'/shelters'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Building class="h-4 w-4" />
				{t.shelters}
			</a>

			<a
				href={resolve('/pre-register')}
				class="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 2xl:gap-2 2xl:px-3 {isActive(
					'/pre-register'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<ClipboardPenLine class="h-4 w-4" />
				{t.preRegister}
			</a>

			<a
				href={resolve('/search')}
				class="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 2xl:gap-2 2xl:px-3 {isActive(
					'/search'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Search class="h-4 w-4" />
				{t.search}
			</a>

			<!-- Donations: donate + track (CR-052 §2.6) — click toggle (not hover) -->
			<div class="relative" bind:this={donationsMenuEl}>
				<button
					type="button"
					onclick={toggleDonationsMenu}
					aria-haspopup="menu"
					aria-expanded={donationsMenuOpen}
					aria-controls={donationsMenuOpen ? 'donations-menu' : undefined}
					class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 2xl:gap-1.5 2xl:px-3 {isDonationsSection() ||
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
						class="absolute right-0 mt-1 min-w-[14rem] rounded-xl border border-border bg-card p-1 shadow-sm"
					>
						<a
							role="menuitem"
							href={resolve('/donations')}
							onclick={closeDonationsMenu}
							class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground {isDonatePage()
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
							class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground {isTrackPage()
								? 'bg-primary-muted text-primary'
								: 'text-muted-foreground'}"
						>
							<Package class="h-3.5 w-3.5" />
							{t.trackDonation}
						</a>
					</div>
				{/if}
			</div>

			<!-- Volunteers Dropdown -->
			<div class="relative" bind:this={volunteersMenuEl}>
				<button
					type="button"
					onclick={() => (volunteersMenuOpen = !volunteersMenuOpen)}
					aria-haspopup="menu"
					aria-expanded={volunteersMenuOpen}
					aria-controls={volunteersMenuOpen ? 'volunteers-menu' : undefined}
					class="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-muted/50 2xl:gap-1.5 2xl:px-3 {isActive(
						'/volunteers'
					) || volunteersMenuOpen
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<UserPlus class="h-4 w-4" />
					{t.volunteers}
					<ChevronDown
						class="h-3.5 w-3.5 text-muted-foreground/75 transition-transform {volunteersMenuOpen
							? 'rotate-180'
							: ''}"
					/>
				</button>
				{#if volunteersMenuOpen}
					<div
						id="volunteers-menu"
						role="menu"
						class="absolute right-0 mt-1 w-60 rounded-xl border border-border bg-card p-1.5 shadow-sm"
					>
						<a
							role="menuitem"
							href={resolve('/volunteers/jobs')}
							onclick={() => (volunteersMenuOpen = false)}
							class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground {page.url.pathname.includes(
								'/volunteers/jobs'
							)
								? 'bg-primary-muted text-primary'
								: 'text-muted-foreground'}"
						>
							<UserPlus class="h-4 w-4 shrink-0" />
							<span>{t.volunteerJobBoard}</span>
						</a>
						<a
							role="menuitem"
							href={resolve('/volunteer/portal')}
							onclick={() => (volunteersMenuOpen = false)}
							class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground {page.url.pathname.includes(
								'/volunteer/portal'
							)
								? 'bg-primary-muted text-primary'
								: 'text-muted-foreground'}"
						>
							<Lock class="h-4 w-4 shrink-0" />
							<span>{t.volunteerPortal}</span>
						</a>
					</div>
				{/if}
			</div>

			<a
				href={resolve('/login')}
				class="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted/50 2xl:gap-2 2xl:px-3 {isActive(
					'/login'
				)
					? 'bg-primary-muted text-primary'
					: ''}"
			>
				<Building2 class="h-4 w-4" />
				{t.backoffice}
			</a>

			<!-- Notification Bell Button (Desktop) -->
			<div class="ml-0.5 flex shrink-0 items-center 2xl:ml-1">
				<PublicNotificationMenu
					variant="navbar"
					{announcements}
					bind:menuOpen={desktopAlertsOpen}
				/>
			</div>

			<!-- Language Switcher (Desktop) -->
			<div class="ml-1.5 flex shrink-0 items-center border-l border-slate-200 pl-2 2xl:ml-2 2xl:pl-3">
				<button
					type="button"
					onclick={toggleLanguage}
					class="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-[#0A2647] shadow-2xs transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-95 2xl:px-3.5"
					aria-label={langState.current === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
				>
					{langState.current === 'th' ? 'EN' : 'TH'}
				</button>
			</div>
		</nav>
	</div>

	<!-- Compact menu sheet (phone + tablet + iPad Pro mid-range) -->
	<Sheet.Root bind:open={mobileMenuOpen}>
		<Sheet.Content id="public-mobile-nav" side="right" class="gap-0 p-0">
			<Sheet.Header class="border-b p-4 pr-14">
				<Sheet.Title>เมนู</Sheet.Title>
			</Sheet.Header>
			<nav class="flex flex-col gap-1 p-4">
				<button
					type="button"
					onclick={() => {
						closeMobileMenu();
						alertsMenuOpen = true;
					}}
					class="flex min-h-11 items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
				>
					<div class="flex items-center gap-3">
						<Bell class="h-5 w-5 text-sky-600" />
						<span>{t.alerts}</span>
					</div>
					{#if announcementsCount > 0}
						<span class="flex h-2.5 w-2.5 items-center justify-center">
							<span class="h-2 w-2 rounded-full bg-red-600"></span>
						</span>
					{/if}
				</button>
				<a
					href={resolve('/')}
					onclick={closeMobileMenu}
					class="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isHomePage()
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Home class="h-5 w-5" />
					{t.home}
				</a>

				<a
					href={resolve('/shelters')}
					onclick={closeMobileMenu}
					class="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
						'/shelters'
					)
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Building class="h-5 w-5" />
					{t.shelters}
				</a>

				<a
					href={resolve('/search')}
					onclick={closeMobileMenu}
					class="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
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
					onclick={closeMobileMenu}
					class="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
						'/pre-register'
					)
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<ClipboardPenLine class="h-5 w-5" />
					{t.preRegister}
				</a>

				<a
					href={resolve('/donations')}
					onclick={closeMobileMenu}
					class="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isDonatePage()
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Heart class="h-5 w-5" />
					{t.donateAndBook}
				</a>

				<a
					href={resolve('/donations/track')}
					onclick={closeMobileMenu}
					class="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isTrackPage()
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Package class="h-5 w-5" />
					{t.trackDonationLong}
				</a>

				<div class="space-y-1 py-1">
					<div class="px-4 py-2 text-xs font-bold tracking-widest text-muted-foreground uppercase">
						{t.volunteers}
					</div>
					<a
						href={resolve('/volunteers/jobs')}
						onclick={() => (mobileMenuOpen = false)}
						class="ml-2 flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50 {page.url.pathname.includes(
							'/volunteers/jobs'
						)
							? 'bg-primary-muted text-primary'
							: 'text-muted-foreground'}"
					>
						<UserPlus class="h-5 w-5" />
						{t.volunteerJobBoard}
					</a>
					<a
						href={resolve('/volunteer/portal')}
						onclick={() => (mobileMenuOpen = false)}
						class="ml-2 flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50 {page.url.pathname.includes(
							'/volunteer/portal'
						)
							? 'bg-primary-muted text-primary'
							: 'text-muted-foreground'}"
					>
						<Lock class="h-5 w-5 shrink-0" />
						{t.volunteerPortal}
					</a>
				</div>

				<a
					href={resolve('/login')}
					onclick={closeMobileMenu}
					class="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 {isActive(
						'/login'
					)
						? 'bg-primary-muted text-primary'
						: ''}"
				>
					<Building2 class="h-5 w-5" />
					{t.backoffice}
				</a>

				<div class="mt-1 border-t border-border/60 pt-2">
					<button
						type="button"
						onclick={() => {
							toggleLanguage();
							mobileMenuOpen = false;
						}}
						class="flex w-full cursor-pointer items-center justify-between rounded-xl px-4 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
					>
						<span class="text-sm font-medium text-slate-700">
							{t.switchLanguage}
						</span>
						<span
							class="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-[#0A2647] shadow-2xs"
						>
							{langState.current === 'th' ? 'EN' : 'TH'}
						</span>
					</button>
				</div>
			</nav>
		</Sheet.Content>
	</Sheet.Root>
</header>

<!-- Spacer preserving header height in document flow so content is never covered -->
<div
	style="height: {headerHeight}px;"
	class="pointer-events-none w-full shrink-0"
	aria-hidden="true"
></div>
