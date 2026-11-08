<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Search from '@lucide/svelte/icons/search';
	import FileText from '@lucide/svelte/icons/file-text';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Heart from '@lucide/svelte/icons/heart';
	import Info from '@lucide/svelte/icons/info';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Ambulance from '@lucide/svelte/icons/ambulance';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Truck from '@lucide/svelte/icons/truck';
	import { PUBLIC_VOLUNTEERS_I18N } from '$lib/constants/i18n/public-volunteers';
	import { PublicHeroMetrics, PublicPageShell } from '$lib/features/public-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	let activeTab = $state('register'); // register | portal | needs
	const t = $derived(getTranslation(PUBLIC_VOLUNTEERS_I18N, langState.current));
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<PublicPageShell class="space-y-8 lg:px-8" maxWidth="max-w-7xl">
	<PublicHeroMetrics
		title={t.heroTitle}
		description={t.heroDescription}
		badgeText={t.heroBadge}
		badgeIcon={UserPlus}
		showLivePing={false}
		bgClass="bg-domain-volunteer-strong"
		showSearch={false}
	/>

	<!-- Tab Bar Navigation -->
	<div class="flex justify-start border-b border-border">
		<div class="inline-flex rounded-t-xl border-x border-t border-border/50 bg-muted/30 p-1">
			<button
				onclick={() => (activeTab = 'register')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'register'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<UserPlus class="h-3.5 w-3.5" />
				{t.tabRegister}
			</button>
			<button
				onclick={() => (activeTab = 'portal')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'portal'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<QrCode class="h-3.5 w-3.5" />
				{t.tabPortal}
			</button>
			<button
				onclick={() => (activeTab = 'needs')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'needs'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<ClipboardList class="h-3.5 w-3.5" />
				{t.tabNeeds}
			</button>
		</div>
	</div>

	<!-- TAB 1: รวมสมัครพลังอาสา -->
	{#if activeTab === 'register'}
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<!-- Form area -->
			<div class="lg:col-span-2">
				<div class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
					<h2 class="text-base font-bold text-foreground">{t.registerTitle}</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						{t.registerIntro}
					</p>

					<form onsubmit={(e) => e.preventDefault()} class="mt-6 space-y-5">
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-1.5">
								<label class="text-xs font-bold text-foreground" for="fullname"
									>{t.fullNameLabel}</label
								>
								<input
									id="fullname"
									type="text"
									placeholder={t.fullNamePlaceholder}
									class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:border-domain-volunteer-strong focus:ring-1 focus:ring-domain-volunteer-strong"
								/>
							</div>
							<div class="flex flex-col gap-1.5">
								<label class="text-xs font-bold text-foreground" for="emergency-phone"
									>{t.emergencyPhoneLabel}</label
								>
								<input
									id="emergency-phone"
									type="text"
									placeholder="08X-XXX-XXXX"
									class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:border-domain-volunteer-strong focus:ring-1 focus:ring-domain-volunteer-strong"
								/>
							</div>
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="text-xs font-bold text-foreground" for="shelter">{t.shelterLabel}</label
							>
							<select
								id="shelter"
								class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-domain-volunteer-strong"
							>
								<option>{t.shelterHatYai}</option>
								<option>{t.shelterKhlongHae}</option>
							</select>
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="text-xs font-bold text-foreground" for="shift">{t.shiftLabel}</label>
							<select
								id="shift"
								class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-domain-volunteer-strong"
							>
								<option>{t.shiftMorning}</option>
								<option>{t.shiftAfternoon}</option>
								<option>{t.shiftNight}</option>
							</select>
						</div>

						<!-- Skills checklist with visual boxes -->
						<div>
							<span class="mb-3 block text-xs font-bold text-foreground">{t.skillsLabel}</span>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<label
									class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 select-none hover:bg-muted/10"
								>
									<input
										type="checkbox"
										class="mt-1 h-4.5 w-4.5 rounded border-border text-domain-volunteer-strong focus:ring-domain-volunteer-strong"
									/>
									<div>
										<span class="flex items-center gap-1.5 text-xs font-bold text-foreground">
											<ChefHat class="h-3.5 w-3.5 text-warning" />
											{t.skillCooking}
										</span>
										<p class="mt-1 text-xs text-muted-foreground">
											{t.skillCookingNote}
										</p>
									</div>
								</label>

								<label
									class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 select-none hover:bg-muted/10"
								>
									<input
										type="checkbox"
										class="mt-1 h-4.5 w-4.5 rounded border-border text-domain-volunteer-strong focus:ring-domain-volunteer-strong"
									/>
									<div>
										<span class="flex items-center gap-1.5 text-xs font-bold text-foreground">
											<Ambulance class="h-3.5 w-3.5 text-danger" />
											{t.skillMedical}
										</span>
										<p class="mt-1 text-xs text-muted-foreground">
											{t.skillMedicalNote}
										</p>
									</div>
								</label>

								<label
									class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 select-none hover:bg-muted/10"
								>
									<input
										type="checkbox"
										class="mt-1 h-4.5 w-4.5 rounded border-border text-domain-volunteer-strong focus:ring-domain-volunteer-strong"
									/>
									<div>
										<span class="flex items-center gap-1.5 text-xs font-bold text-foreground">
											<FileText class="h-3.5 w-3.5 text-domain-volunteer-strong" />
											{t.skillScreening}
										</span>
										<p class="mt-1 text-xs text-muted-foreground">
											{t.skillScreeningNote}
										</p>
									</div>
								</label>

								<label
									class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 select-none hover:bg-muted/10"
								>
									<input
										type="checkbox"
										class="mt-1 h-4.5 w-4.5 rounded border-border text-domain-volunteer-strong focus:ring-domain-volunteer-strong"
									/>
									<div>
										<span class="flex items-center gap-1.5 text-xs font-bold text-foreground">
											<Truck class="h-3.5 w-3.5 text-warning-foreground" />
											{t.skillLogistics}
										</span>
										<p class="mt-1 text-xs text-muted-foreground">
											{t.skillLogisticsNote}
										</p>
									</div>
								</label>
							</div>
						</div>

						<button
							type="submit"
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-domain-volunteer-strong py-3.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-domain-volunteer-text"
						>
							{t.submit}
						</button>
					</form>
				</div>
			</div>

			<!-- Sidebar -->
			<div class="flex flex-col gap-5">
				<!-- Welfare list -->
				<div class="rounded-3xl border border-border bg-card p-5 shadow-sm">
					<h3 class="flex items-center gap-1.5 text-sm font-bold text-foreground">
						<Heart class="h-4.5 w-4.5 text-danger" />
						{t.welfareTitle}
					</h3>
					<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
						{t.welfareIntro}
					</p>

					<div class="mt-4 space-y-3.5">
						<div class="flex gap-2.5">
							<span class="text-sm">🍱</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">{t.welfareMealTitle}</h4>
								<p class="text-xs text-muted-foreground">
									{t.welfareMealBody}
								</p>
							</div>
						</div>
						<div class="flex gap-2.5">
							<span class="text-sm">💧</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">{t.welfareWaterTitle}</h4>
								<p class="text-xs text-muted-foreground">
									{t.welfareWaterBody}
								</p>
							</div>
						</div>
						<div class="flex gap-2.5">
							<span class="text-sm">🦺</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">{t.welfareGearTitle}</h4>
								<p class="text-xs text-muted-foreground">
									{t.welfareGearBody}
								</p>
							</div>
						</div>
					</div>
				</div>

				<!-- Safety Info -->
				<div class="rounded-3xl border border-warning-border/40 bg-warning/5 p-5">
					<h4 class="flex items-center gap-1.5 text-xs font-bold text-warning-foreground">
						<Info class="h-4 w-4 text-warning-foreground" />
						{t.safetyTitle}
					</h4>
					<p class="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
						{t.safetyBody}
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- TAB 2: พอร์ทัล & บัตรงานอาสา -->
	{#if activeTab === 'portal'}
		<div class="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<UserCheck class="h-5 w-5 text-domain-volunteer-strong" />
				{t.portalTitle}
			</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				{t.portalIntro}
			</p>

			<!-- Search Bar -->
			<div class="mt-6 flex gap-3">
				<div class="relative flex-1">
					<input
						type="text"
						placeholder={t.portalSearchPlaceholder}
						class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 pl-10 text-xs text-foreground outline-hidden focus:border-domain-volunteer-strong focus:ring-1 focus:ring-domain-volunteer-strong"
					/>
					<Search class="absolute top-3.5 left-3.5 h-4 w-4 text-muted-foreground" />
				</div>
				<button
					class="rounded-xl bg-domain-volunteer-strong px-5 py-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-domain-volunteer-text"
				>
					{t.portalSearchButton}
				</button>
			</div>

			<!-- Search Placeholder Card -->
			<div class="mt-8 rounded-2xl border border-dashed border-border bg-muted/10 p-10 text-center">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground/80"
				>
					<QrCode class="h-6 w-6" />
				</div>
				<h4 class="text-sm font-bold text-foreground">{t.portalEmptyTitle}</h4>
				<p class="mx-auto mt-1.5 max-w-sm text-xs text-muted-foreground">
					{t.portalEmptyBody}
				</p>
			</div>
		</div>
	{/if}

	<!-- TAB 3: ประกาศความต้องการกำลังพล -->
	{#if activeTab === 'needs'}
		<div class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
			<div
				class="mb-6 flex flex-col justify-between gap-4 border-b border-border/60 pb-6 md:flex-row md:items-center"
			>
				<div>
					<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
						<ClipboardList class="h-5 w-5 text-domain-volunteer-strong" />
						{t.needsTitle}
					</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						{t.needsIntro}
					</p>
				</div>
				<!-- Search -->
				<div class="relative w-full md:w-80">
					<input
						type="text"
						placeholder={t.needsSearchPlaceholder}
						class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 pl-9 text-xs text-foreground outline-hidden focus:border-domain-volunteer-strong focus:ring-1 focus:ring-domain-volunteer-strong"
					/>
					<Search class="absolute top-3 left-3 h-3.5 w-3.5 text-muted-foreground" />
				</div>
			</div>

			<!-- List -->
			<div class="flex flex-col gap-6">
				<!-- Shelter Row 1 -->
				<div class="rounded-2xl border border-border bg-muted/5 p-5">
					<div
						class="mb-4 flex flex-col justify-between gap-4 border-b border-border/50 pb-4 sm:flex-row sm:items-start"
					>
						<div>
							<h3 class="text-sm font-bold text-foreground">
								{t.shelterHatYai}
							</h3>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{t.needsHatYaiOwner}
							</p>
						</div>
						<span
							class="shrink-0 rounded-lg bg-danger-muted/30 px-3 py-1.5 text-xs font-bold text-danger"
						>
							{t.needsMoreVolunteers(6)}
						</span>
					</div>

					<div class="mb-3 text-xs font-bold text-foreground">{t.needsSkillsHeading}</div>
					<div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• {t.needsCook}</span>
							<span class="font-bold text-foreground">{t.needsPeople(2)}</span>
						</div>
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• {t.needsMedical}</span>
							<span class="font-bold text-foreground">{t.needsPeople(0)}</span>
						</div>
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• {t.needsScreening}</span>
							<span class="font-bold text-foreground">{t.needsPeople(1)}</span>
						</div>
					</div>

					<button
						onclick={() => (activeTab = 'register')}
						class="flex w-full cursor-pointer items-center justify-center rounded-xl bg-domain-volunteer-strong py-3 text-xs font-bold text-primary-foreground shadow-sm transition-colors hover:bg-domain-volunteer-text"
					>
						{t.needsApply}
					</button>
				</div>

				<!-- Shelter Row 2 -->
				<div class="rounded-2xl border border-border bg-muted/5 p-5">
					<div
						class="mb-4 flex flex-col justify-between gap-4 border-b border-border/50 pb-4 sm:flex-row sm:items-start"
					>
						<div>
							<h3 class="text-sm font-bold text-foreground">
								{t.shelterKhlongHae}
							</h3>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{t.needsKhlongHaeOwner}
							</p>
						</div>
						<span
							class="shrink-0 rounded-lg bg-danger-muted/30 px-3 py-1.5 text-xs font-bold text-danger"
						>
							{t.needsMoreVolunteers(6)}
						</span>
					</div>

					<div class="mb-3 text-xs font-bold text-foreground">{t.needsSkillsHeading}</div>
					<div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• {t.needsCook}</span>
							<span class="font-bold text-foreground">{t.needsPeople(4)}</span>
						</div>
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• {t.needsMedical}</span>
							<span class="font-bold text-foreground">{t.needsPeople(1)}</span>
						</div>
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• {t.needsScreening}</span>
							<span class="font-bold text-foreground">{t.needsPeople(1)}</span>
						</div>
					</div>

					<button
						onclick={() => (activeTab = 'register')}
						class="flex w-full cursor-pointer items-center justify-center rounded-xl bg-domain-volunteer-strong py-3 text-xs font-bold text-primary-foreground shadow-sm transition-colors hover:bg-domain-volunteer-text"
					>
						{t.needsApply}
					</button>
				</div>
			</div>
		</div>
	{/if}
</PublicPageShell>
