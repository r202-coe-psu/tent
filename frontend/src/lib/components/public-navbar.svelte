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

	import { onMount } from 'svelte';
	import * as Select from '$lib/components/ui/select';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_NAVBAR_I18N, SUPPORTED_LANGUAGES } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import type { Announcement } from '$lib/features/announcements';
	import PublicEmergencyModal from '$lib/components/public-emergency-modal.svelte';

	interface Props {
		announcements?: Announcement[];
	}

	let { announcements: propAnnouncements = [] }: Props = $props();

	let fetchedAnnouncements = $state<Announcement[]>([]);
	let alertsModalOpen = $state(false);

	const announcements = $derived(
		propAnnouncements && propAnnouncements.length > 0 ? propAnnouncements : fetchedAnnouncements
	);
	const announcementsCount = $derived(announcements.length);
	const hasEmergency = $derived(announcements.some((a) => a.severity === 'emergency'));

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
	let alertsMenuEl: HTMLDivElement | undefined = $state();
	let alertsButtonEl: HTMLButtonElement | undefined = $state();

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
		if (alertsMenuOpen && alertsMenuEl) {
			if (alertsButtonEl && alertsButtonEl.contains(target)) {
				return;
			}
			if (!alertsMenuEl.contains(target)) {
				closeAlertsMenu();
			}
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
	<div class="relative z-50 mx-auto flex max-w-7xl flex-nowrap items-center justify-between gap-3">
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
				bind:this={alertsButtonEl}
				type="button"
				onclick={toggleAlertsMenu}
				class="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#0284C7] focus-visible:outline-none {alertsMenuOpen
					? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300'
					: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
				aria-label="การแจ้งเตือนภัย {announcementsCount > 0 ? `(${announcementsCount})` : ''}"
				aria-expanded={alertsMenuOpen}
			>
				<Bell class="h-4 w-4 text-sky-600" />
				{#if announcementsCount > 0}
					<span class="absolute top-1.5 right-1.5 flex h-2 w-2">
						{#if hasEmergency}
							<span
								class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"
							></span>
						{/if}
						<span class="ring-1.5 relative inline-flex h-2 w-2 rounded-full bg-red-600 ring-white"
						></span>
					</span>
				{/if}
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
		<!-- Mobile backdrop overlay to guarantee outside clicks close the menu -->
		<button
			type="button"
			tabindex="-1"
			aria-hidden="true"
			class="fixed inset-0 z-40 cursor-default bg-slate-900/20 backdrop-blur-[1px] lg:hidden"
			onclick={closeAlertsMenu}
		></button>

		<div
			bind:this={alertsMenuEl}
			role="dialog"
			aria-label="การแจ้งเตือนภัยฉุกเฉิน"
			class="absolute top-full right-4 z-50 mt-2 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl sm:right-6"
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
				<div class="flex items-center gap-1.5">
					{#if announcementsCount > 0}
						<span
							class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-2xs font-semibold text-red-700"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>
							ประกาศใหม่
						</span>
					{:else}
						<span
							class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-2xs font-medium text-slate-500"
						>
							ไม่มีประกาศใหม่
						</span>
					{/if}
					<!-- Dedicated Close 'X' Button -->
					<button
						type="button"
						onclick={closeAlertsMenu}
						class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[#0284C7] focus-visible:outline-none"
						aria-label="ปิดการแจ้งเตือน"
						title="ปิดการแจ้งเตือน"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			<div class="mt-3 max-h-[60vh] space-y-3 overflow-y-auto">
				{#if announcements.length > 0}
					{#each announcements as ann (ann._id)}
						{@const isDanger = ann.severity === 'emergency'}
						{@const isWarning = ann.severity === 'warning'}
						<button
							type="button"
							onclick={() => {
								closeAlertsMenu();
								alertsModalOpen = true;
							}}
							class="w-full rounded-xl border p-3.5 text-left shadow-2xs transition-all {isDanger
								? 'border-red-200 bg-red-50/40 hover:border-red-300 hover:bg-red-50/60'
								: isWarning
									? 'border-amber-200 bg-amber-50/40 hover:border-amber-300 hover:bg-amber-50/60'
									: 'border-sky-200 bg-sky-50/40 hover:border-sky-300 hover:bg-sky-50/60'}"
						>
							<div class="flex items-center justify-between gap-2">
								<span
									class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-bold {isDanger
										? 'border-red-200 bg-red-50 text-red-700'
										: isWarning
											? 'border-amber-200 bg-amber-50 text-amber-800'
											: 'border-blue-200 bg-blue-50 text-blue-700'}"
								>
									<span
										class="h-1.5 w-1.5 rounded-full {isDanger
											? 'bg-red-600'
											: isWarning
												? 'bg-amber-500'
												: 'bg-blue-500'}"
									></span>
									{isDanger
										? 'วิกฤติ (Emergency)'
										: isWarning
											? 'เตือนภัย (Warning)'
											: 'ข้อมูลทั่วไป (Info)'}
								</span>
								{#if ann.created_at}
									<span class="text-2xs text-slate-400 tabular-nums">
										{new Date(ann.created_at).toLocaleTimeString('th-TH', {
											hour: '2-digit',
											minute: '2-digit'
										})} น.
									</span>
								{/if}
							</div>
							<h4 class="mt-2 text-xs font-bold text-slate-900">
								{ann.title}
							</h4>
							<p class="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-600">
								{ann.description}
							</p>
						</button>
					{/each}
				{:else}
					<div
						class="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-slate-500"
					>
						<p class="text-xs font-medium">ไม่มีประกาศแจ้งเตือนภัยในขณะนี้</p>
						<p class="mt-0.5 text-2xs text-slate-400">
							สถานการณ์ปกติ ทุกศูนย์พักพิงเปิดให้บริการตามปกติ
						</p>
					</div>
				{/if}
			</div>

			<div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
				<button
					type="button"
					onclick={() => {
						closeAlertsMenu();
						alertsModalOpen = true;
					}}
					class="cursor-pointer text-xs font-bold text-[#0284C7] hover:underline"
				>
					ดูรายละเอียดประกาศทั้งหมด →
				</button>
				<button
					type="button"
					onclick={closeAlertsMenu}
					class="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 hover:text-slate-900"
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
					{#if announcementsCount > 0}
						<span class="flex h-2.5 w-2.5 items-center justify-center">
							<span class="h-2 w-2 rounded-full bg-red-600"></span>
						</span>
					{/if}
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

<PublicEmergencyModal bind:open={alertsModalOpen} {announcements} />
