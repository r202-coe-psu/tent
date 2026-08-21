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
	import { BookingModal } from '$lib/features/public-register';

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
	// Booking has no route of its own — the navbar opens the dialog in place.
	let bookingOpen = $state(false);

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
					<span class="text-base font-bold tracking-tight text-foreground">Smart Shelter</span>
					<span class="text-[10px] font-semibold tracking-wider text-primary uppercase"
						>Public & RFL Portal</span
					>
				</div>
			</a>
		</div>

		<!-- Mobile Menu Button -->
		<button
			class="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted md:hidden"
			onclick={toggleMobileMenu}
			aria-label="Toggle mobile menu"
		>
			{#if mobileMenuOpen}
				<X class="h-6 w-6" />
			{:else}
				<Menu class="h-6 w-6" />
			{/if}
		</button>

		<!-- Navbar Links -->
		<nav class="hidden items-center gap-1 md:flex">
			<a
				href={resolve('/')}
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isHomePage()
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Home class="h-4 w-4" />
				หน้าแรก
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
				ตรวจสอบศูนย์พักพิง
			</a>

			<!-- Booking (CR-070 / T-71) — no route of its own, opens the dialog in place. -->
			<button
				type="button"
				onclick={() => (bookingOpen = true)}
				class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
			>
				<ClipboardCheck class="h-4 w-4" />
				จองเข้าศูนย์
			</button>

			<a
				href={resolve('/search')}
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isActive(
					'/search'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<Search class="h-4 w-4" />
				สืบค้นญาติ
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
					บริจาค
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
							บริจาคและจองคิว
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
							ตรวจสอบสถานะ
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
				ระบบหลังบ้าน
			</a>
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
					หน้าแรก
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
					ตรวจสอบศูนย์พักพิง
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
					สืบค้นญาติ
				</a>

				<button
					type="button"
					onclick={() => {
						mobileMenuOpen = false;
						bookingOpen = true;
					}}
					class="flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
				>
					<ClipboardCheck class="h-5 w-5" />
					จองเข้าศูนย์ล่วงหน้า
				</button>

				<a
					href={resolve('/donations')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isDonatePage()
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<Heart class="h-5 w-5" />
					บริจาคและจองคิว
				</a>

				<a
					href={resolve('/donations/track')}
					onclick={() => (mobileMenuOpen = false)}
					class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 {isTrackPage()
						? 'bg-primary-muted text-primary'
						: 'text-muted-foreground'}"
				>
					<PackageSearch class="h-5 w-5" />
					ตรวจสอบสถานะบริจาค
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
					ระบบหลังบ้าน
				</a>
			</nav>
		</div>
	{/if}
</header>

<BookingModal bind:open={bookingOpen} />
