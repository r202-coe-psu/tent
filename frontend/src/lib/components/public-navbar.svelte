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
	import Bell from '@lucide/svelte/icons/bell';

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
	let alertsMenuOpen = $state(false);
	let alertsMenuEl: HTMLDivElement | undefined = $state();

	const t = $derived(getTranslation(PUBLIC_NAVBAR_I18N, langState.current));

	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
		if (mobileMenuOpen) {
			alertsMenuOpen = false;
			donationsMenuOpen = false;
		}
	}

	function toggleDonationsMenu() {
		donationsMenuOpen = !donationsMenuOpen;
		if (donationsMenuOpen) {
			alertsMenuOpen = false;
		}
	}

	function closeDonationsMenu() {
		donationsMenuOpen = false;
	}

	function toggleAlertsMenu() {
		alertsMenuOpen = !alertsMenuOpen;
		if (alertsMenuOpen) {
			donationsMenuOpen = false;
			mobileMenuOpen = false;
		}
	}

	function closeAlertsMenu() {
		alertsMenuOpen = false;
	}

	function handleWindowPointerDown(event: PointerEvent) {
		const target = event.target as Node;
		if (donationsMenuOpen && donationsMenuEl && !donationsMenuEl.contains(target)) {
			closeDonationsMenu();
		}
		if (alertsMenuOpen && alertsMenuEl && !alertsMenuEl.contains(target)) {
			closeAlertsMenu();
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		closeDonationsMenu();
		closeAlertsMenu();
	}

	afterNavigate(() => {
		donationsMenuOpen = false;
		mobileMenuOpen = false;
		alertsMenuOpen = false;
	});
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<header
	class="sticky top-0 z-50 w-full border-b border-border bg-card/95 px-6 py-3 shadow-xs backdrop-blur-md"
>
	<div class="mx-auto flex max-w-7xl flex-nowrap items-center justify-between gap-3">
		<!-- Logo and Title -->
		<div class="flex min-w-0 shrink items-center gap-3">
			<a href={resolve('/')} class="flex min-w-0 items-center gap-2">
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

		<!-- Compact controls: phone + tablet (hamburger through lg) -->
		<div class="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:hidden">
			<!-- Notification Bell Button (Mobile) -->
			<button
				type="button"
				onclick={toggleAlertsMenu}
				class="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-[#0284C7] focus-visible:outline-none"
				aria-label="การแจ้งเตือนภัย (2)"
				aria-expanded={alertsMenuOpen}
			>
				<Bell class="h-4 w-4 text-sky-600" />
				<span
					class="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white tabular-nums shadow-2xs"
				>
					2
				</span>
			</button>

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
				<Compass class="h-4 w-4" />
				{t.shelters}
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

			<a
				href={resolve('/pre-register')}
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted/50 {isActive(
					'/pre-register'
				)
					? 'bg-primary-muted text-primary'
					: 'text-muted-foreground'}"
			>
				<ClipboardCheck class="h-4 w-4" />
				{t.preRegister}
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
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted/50 {isActive(
					'/login'
				)
					? 'bg-primary-muted text-primary'
					: ''}"
			>
				<Building2 class="h-4 w-4" />
				{t.backoffice}
			</a>

			<div class="ml-2 flex shrink-0 items-center border-l border-border pl-3">
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

	<!-- Alerts & Notifications Dropdown Panel -->
	{#if alertsMenuOpen}
		<div
			bind:this={alertsMenuEl}
			role="dialog"
			aria-label="การแจ้งเตือนภัยฉุกเฉิน"
			class="absolute top-full right-4 z-50 mt-2 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-slate-200/80 bg-white p-4 shadow-md sm:right-6"
		>
			<div class="flex items-center justify-between border-b border-slate-100 pb-3">
				<div class="flex items-center gap-2">
					<div class="flex h-7 w-7 items-center justify-center rounded-full bg-sky-50 text-sky-600">
						<Bell class="h-4 w-4" />
					</div>
					<div>
						<h3 class="text-sm font-bold text-slate-900">การแจ้งเตือนภัยฉุกเฉิน</h3>
						<p class="text-2xs text-slate-500">ศูนย์บัญชาการสถานการณ์ (EOC)</p>
					</div>
				</div>
				<span
					class="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-2xs font-bold text-red-600 tabular-nums"
				>
					2 ประกาศใหม่
				</span>
			</div>

			<div class="mt-3 space-y-2.5">
				<div
					class="rounded-xl border border-red-200 bg-white p-3 shadow-2xs transition-all hover:border-red-300"
				>
					<div class="flex items-center justify-between">
						<span
							class="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-2xs font-bold text-red-700"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>
							วิกฤติ (Emergency)
						</span>
						<span class="text-2xs text-slate-400 tabular-nums">15 นาทีที่แล้ว</span>
					</div>
					<h4 class="mt-1.5 text-xs font-bold text-slate-900">
						แจ้งเตือนระดับน้ำวิกฤติ — อ.แม่สาย
					</h4>
					<p class="mt-1 text-xs leading-relaxed text-slate-600">
						เฝ้าระวังน้ำล้นตลิ่งตลอด 24 ชม.
						เตรียมพร้อมอพยพผู้พักพิงกลุ่มเปราะบางสู่ศูนย์พักพิงที่ปลอดภัย
					</p>
				</div>

				<div
					class="rounded-xl border border-amber-200 bg-white p-3 shadow-2xs transition-all hover:border-amber-300"
				>
					<div class="flex items-center justify-between">
						<span
							class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-bold text-amber-800"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
							เตือนภัย (Warning)
						</span>
						<span class="text-2xs text-slate-400 tabular-nums">1 ชม. ที่แล้ว</span>
					</div>
					<h4 class="mt-1.5 text-xs font-bold text-slate-900">เปิดศูนย์พักพิงชั่วคราวเพิ่มเติม</h4>
					<p class="mt-1 text-xs leading-relaxed text-slate-600">
						เทศบาลตำบลเวียงพางคำ พร้อมรับผู้ประสบภัย มีเตียงว่าง 85 เตียง พร้อมทีมแพทย์ประจำการ
					</p>
				</div>
			</div>

			<div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
				<a
					href={resolve('/')}
					onclick={() => {
						closeAlertsMenu();
						const el = document.getElementById('announcements');
						if (el) el.scrollIntoView({ behavior: 'smooth' });
					}}
					class="text-xs font-bold text-[#0284C7] hover:underline"
				>
					ดูรายละเอียดประกาศทั้งหมด →
				</a>
				<button
					type="button"
					onclick={closeAlertsMenu}
					class="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
				>
					ปิด
				</button>
			</div>
		</div>
	{/if}

	<!-- Compact menu dropdown (phone + tablet) -->
	{#if mobileMenuOpen}
		<div class="absolute top-full left-0 w-full border-b border-border bg-card shadow-lg lg:hidden">
			<nav class="flex flex-col gap-2 p-4">
				<button
					type="button"
					onclick={() => {
						mobileMenuOpen = false;
						alertsMenuOpen = true;
					}}
					class="flex items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
				>
					<div class="flex items-center gap-3">
						<Bell class="h-5 w-5 text-sky-600" />
						<span>การแจ้งเตือนภัย</span>
					</div>
					<span
						class="rounded-full bg-red-600 px-2 py-0.5 text-2xs font-bold text-white tabular-nums"
					>
						2
					</span>
				</button>
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
					{t.preRegister}
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
