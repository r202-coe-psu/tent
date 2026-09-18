<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import Bell from '@lucide/svelte/icons/bell';
	import X from '@lucide/svelte/icons/x';
	import PublicEmergencyModal from '$lib/components/public-emergency-modal.svelte';
	import type { Announcement } from '$lib/features/announcements';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_ALERTS_PANEL_I18N } from '$lib/constants/i18n';

	interface Props {
		announcements?: Announcement[];
		variant?: 'navbar' | 'floating';
		menuOpen?: boolean;
		class?: string;
	}

	let {
		announcements: propAnnouncements = [],
		variant = 'navbar',
		menuOpen = $bindable(false),
		class: customClass = ''
	}: Props = $props();

	let fetchedAnnouncements = $state<Announcement[]>([]);
	let modalOpen = $state(false);
	let buttonEl = $state<HTMLElement | null>(null);
	let menuEl = $state<HTMLElement | null>(null);

	const isEn = $derived(langState.current === 'en');
	const t = $derived(getTranslation(PUBLIC_ALERTS_PANEL_I18N, langState.current));

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
				console.error('Failed to fetch announcements in PublicNotificationMenu', e);
			}
		}

		if (typeof window !== 'undefined' && window.location.hash === '#announcements') {
			menuOpen = true;
		}
	});

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	function closeMenu() {
		menuOpen = false;
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (!menuOpen || !menuEl) return;
		const target = event.target as Node;
		if (buttonEl && buttonEl.contains(target)) return;
		if (!menuEl.contains(target)) {
			closeMenu();
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && menuOpen) {
			closeMenu();
		}
	}

	afterNavigate(() => {
		menuOpen = false;
	});
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

{#if variant === 'navbar'}
	<!-- Navbar mode: Compact icon button for mobile and desktop headers -->
	<div class="relative inline-flex items-center {customClass}">
		<button
			bind:this={buttonEl}
			type="button"
			onclick={toggleMenu}
			class="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#0284C7] focus-visible:outline-none {menuOpen
				? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300'
				: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
			aria-label="{t.alertsAriaLabel} {announcementsCount > 0 ? `(${announcementsCount})` : ''}"
			aria-expanded={menuOpen}
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

		{#if menuOpen}
			<!-- Mobile backdrop overlay -->
			<button
				type="button"
				tabindex="-1"
				aria-hidden="true"
				class="fixed inset-0 z-40 cursor-default bg-slate-900/20 backdrop-blur-[1px] lg:hidden"
				onclick={closeMenu}
			></button>

			<div
				bind:this={menuEl}
				role="dialog"
				aria-label={t.title}
				class="fixed top-14 right-4 left-4 z-50 mx-auto mt-1.5 max-w-sm rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mx-0 sm:mt-2 sm:w-96 sm:max-w-sm"
			>
				<div class="border-b border-slate-100 pb-3">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2">
							<div
								class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600"
							>
								<Bell class="h-4 w-4" />
							</div>
							<h3 class="text-sm font-bold text-slate-900">{t.title}</h3>
						</div>
						<button
							type="button"
							onclick={closeMenu}
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[#0284C7] focus-visible:outline-none"
							aria-label={t.closeAlerts}
							title={t.closeAlerts}
						>
							<X class="h-4 w-4" />
						</button>
					</div>
					<div class="mt-1 flex items-center justify-between gap-2 pl-9">
						<p class="text-2xs text-slate-500">{t.subtitle}</p>
						{#if announcementsCount > 0}
							<span
								class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-2xs font-semibold whitespace-nowrap text-red-700"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>
								{t.newAnnouncements}
							</span>
						{:else}
							<span
								class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-2xs font-medium whitespace-nowrap text-slate-500"
							>
								{t.noNewAnnouncements}
							</span>
						{/if}
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
									closeMenu();
									modalOpen = true;
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
										{isDanger ? t.emergencyBadge : isWarning ? t.warningBadge : t.infoBadge}
									</span>
									{#if ann.created_at}
										<span class="text-2xs text-slate-400 tabular-nums">
											{new Date(ann.created_at).toLocaleTimeString(isEn ? 'en-US' : 'th-TH', {
												hour: '2-digit',
												minute: '2-digit'
											})}
											{isEn ? '' : 'น.'}
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
							<p class="text-xs font-medium">{t.emptyTitle}</p>
							<p class="mt-0.5 text-2xs text-slate-400">
								{t.emptySubtitle}
							</p>
						</div>
					{/if}
				</div>

				<div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
					<button
						type="button"
						onclick={() => {
							closeMenu();
							modalOpen = true;
						}}
						class="cursor-pointer text-xs font-bold text-[#0284C7] hover:underline"
					>
						{t.viewAll}
					</button>
					<button
						type="button"
						onclick={closeMenu}
						class="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 hover:text-slate-900"
					>
						{t.close}
					</button>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<!-- Floating mode: Pill button for PC and bottom-docked view -->
	<div
		class="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2.5 md:right-6 md:bottom-6 {customClass}"
	>
		<div class="relative">
			<button
				bind:this={buttonEl}
				type="button"
				onclick={toggleMenu}
				aria-label="{t.alertsAriaLabel} {announcementsCount > 0 ? `(${announcementsCount})` : ''}"
				aria-expanded={menuOpen}
				class="relative hidden items-center justify-center rounded-full bg-[#0284C7] whitespace-nowrap text-white shadow-md transition-all duration-200 hover:bg-[#0369a1] hover:shadow-lg focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95 md:inline-flex md:h-auto md:w-full md:gap-2 md:px-4 md:py-2.5 md:text-xs md:font-bold"
			>
				<Bell class="h-4 w-4 shrink-0 text-amber-300" />
				<span>{t.emergencyAlertsBtn}</span>
				{#if announcementsCount > 0}
					<span class="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
						{#if hasEmergency}
							<span
								class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"
							></span>
						{/if}
						<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white"
						></span>
					</span>
				{/if}
			</button>

			{#if menuOpen}
				<!-- Backdrop overlay -->
				<button
					type="button"
					tabindex="-1"
					aria-hidden="true"
					class="fixed inset-0 z-40 cursor-default bg-slate-900/20 backdrop-blur-[1px] md:hidden"
					onclick={closeMenu}
				></button>

				<div
					bind:this={menuEl}
					role="dialog"
					aria-label={t.title}
					class="fixed right-4 bottom-20 left-4 z-50 mx-auto max-w-sm rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl sm:absolute sm:right-0 sm:bottom-full sm:left-auto sm:mx-0 sm:mb-3 sm:w-96 sm:max-w-sm"
				>
					<div class="border-b border-slate-100 pb-3">
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<div
									class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600"
								>
									<Bell class="h-4 w-4" />
								</div>
								<h3 class="text-sm font-bold text-slate-900">{t.title}</h3>
							</div>
							<button
								type="button"
								onclick={closeMenu}
								class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[#0284C7] focus-visible:outline-none"
								aria-label={t.closeAlerts}
								title={t.closeAlerts}
							>
								<X class="h-4 w-4" />
							</button>
						</div>
						<div class="mt-1 flex items-center justify-between gap-2 pl-9">
							<p class="text-2xs text-slate-500">{t.subtitle}</p>
							{#if announcementsCount > 0}
								<span
									class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-2xs font-semibold whitespace-nowrap text-red-700"
								>
									<span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>
									{t.newAnnouncements}
								</span>
							{:else}
								<span
									class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-2xs font-medium whitespace-nowrap text-slate-500"
								>
									{t.noNewAnnouncements}
								</span>
							{/if}
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
										closeMenu();
										modalOpen = true;
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
											{isDanger ? t.emergencyBadge : isWarning ? t.warningBadge : t.infoBadge}
										</span>
										{#if ann.created_at}
											<span class="text-2xs text-slate-400 tabular-nums">
												{new Date(ann.created_at).toLocaleTimeString(isEn ? 'en-US' : 'th-TH', {
													hour: '2-digit',
													minute: '2-digit'
												})}
												{isEn ? '' : 'น.'}
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
								<p class="text-xs font-medium">{t.emptyTitle}</p>
								<p class="mt-0.5 text-2xs text-slate-400">
									{t.emptySubtitle}
								</p>
							</div>
						{/if}
					</div>

					<div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
						<button
							type="button"
							onclick={() => {
								closeMenu();
								modalOpen = true;
							}}
							class="cursor-pointer text-xs font-bold text-[#0284C7] hover:underline"
						>
							{t.viewAll}
						</button>
						<button
							type="button"
							onclick={closeMenu}
							class="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 hover:text-slate-900"
						>
							{t.close}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<PublicEmergencyModal bind:open={modalOpen} {announcements} />
