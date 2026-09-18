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
	import Bell from '@lucide/svelte/icons/bell';
	// import Users from '@lucide/svelte/icons/users'; // Volunteer link temporarily disabled

	import { onMount } from 'svelte';
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

	let fetchedAnnouncements = $state<Announcement[]>([]);

	const announcements = $derived(
		propAnnouncements && propAnnouncements.length > 0 ? propAnnouncements : fetchedAnnouncements
	);
	const announcementsCount = $derived(announcements.length);

	onMount(async () => {
		if (propAnnouncements.length === 0) {
			try {
				const res = await fetch('/api/public/v1/announcements');
				if (res.ok) {
					const data = await res.json();
					fetchedAnnouncements = (data.items as Announcement[]) || [];
				}
			} catch (e) {
				console.error('Failed to fetch announcements in navbar', e);
			}
		}
	});

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
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		closeDonationsMenu();
	}

	afterNavigate(() => {
		donationsMenuOpen = false;
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
					class="h-8 w-8 shrink-0 rounded-lg sm:h-9 sm:w-9"
				/>
				<span class="truncate text-sm font-bold tracking-tight text-foreground sm:text-base"
					>PSU Smart Shelter</span
				>
			</a>
		</div>

		<!-- Compact controls: phone + tablet (hamburger through lg) -->
		<div class="flex shrink-0 items-center gap-1 sm:gap-2 lg:hidden">
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

		<!-- Full horizontal nav: desktop lg+ only (avoids tablet wrap over form CTAs) -->
		<nav class="hidden flex-nowrap items-center gap-1 lg:flex">
			<a
				href={resolve('/')}
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 {isHomePage()
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Home class="h-4 w-4" />
				{t.home}
			</a>

			<a
				href={resolve('/shelters')}
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 {isActive(
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
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 {isActive(
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
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 {isActive(
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
					class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 {isDonationsSection() ||
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

			<!-- Volunteers (Access temporarily disabled per user request) -->
			<!--
			<a
				href={resolve('/volunteers')}
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 {isActive(
					'/volunteers'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Users class="h-4 w-4" />
				{t.volunteer}
			</a>
			-->

			<a
				href={resolve('/login')}
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted/50 {isActive(
					'/login'
				)
					? 'bg-primary-muted text-primary'
					: ''}"
			>
				<Building2 class="h-4 w-4" />
				{t.backoffice}
			</a>

			<!-- Notification Bell Button (Desktop) -->
			<div class="ml-1 flex shrink-0 items-center">
				<PublicNotificationMenu
					variant="navbar"
					{announcements}
					bind:menuOpen={desktopAlertsOpen}
				/>
			</div>

			<!-- Language Switcher (Desktop) -->
			<div class="ml-2 flex shrink-0 items-center border-l border-slate-200 pl-3">
				<button
					type="button"
					onclick={toggleLanguage}
					class="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 py-1 text-xs font-bold text-[#0A2647] shadow-2xs transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-95"
					aria-label={langState.current === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
				>
					{langState.current === 'th' ? 'EN' : 'TH'}
				</button>
			</div>
		</nav>
	</div>

	<!-- Compact menu sheet (phone + tablet) -->
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

				<!-- Volunteers (Access temporarily disabled per user request) -->
				<!--
				<a
					href={resolve('/volunteers')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
						'/volunteers'
					)
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Users class="h-5 w-5" />
					{t.volunteer}
				</a>
				-->

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
