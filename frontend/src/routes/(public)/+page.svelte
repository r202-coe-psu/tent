<script lang="ts">
	import type { PageData } from './$types';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Search from '@lucide/svelte/icons/search';
	import HelpCircle from '@lucide/svelte/icons/help-circle';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import PhoneCall from '@lucide/svelte/icons/phone-call';
	import Package from '@lucide/svelte/icons/package';
	import Compass from '@lucide/svelte/icons/compass';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import PublicQuickServiceCard from '$lib/components/public-quick-service-card.svelte';
	import PublicEmergencyBanner from '$lib/components/public-emergency-banner.svelte';
	import {
		FamilySearchModal,
		PublicHeroMetrics,
		PublicPageShell
	} from '$lib/features/public-portal';
	import { BookingModal } from '$lib/features/public-register';
	import PublicActionBtn from '$lib/components/public-action-btn.svelte';

	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_HOME_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let { data }: { data: PageData } = $props();

	let bookingOpen = $state(false);
	let searchOpen = $state(false);

	const t = $derived(getTranslation(PUBLIC_HOME_I18N, langState.current));
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<PublicPageShell class="space-y-8">
	<!-- 1. Urgent Announcements and Others -->
	{#if data.announcements && data.announcements.length > 0}
		{#each data.announcements as announcement (announcement._id)}
			<PublicEmergencyBanner {announcement} />
		{/each}
	{/if}

	<!-- 2. Hero Section -->
	<PublicHeroMetrics />

	<!-- 3. Service Menu and Eligibility Checking -->
	<section>
		<div class="mb-8">
			<div class="mb-2 flex items-center gap-2">
				<Compass class="h-5 w-5 text-muted-foreground" />
				<h2 class="text-xl font-bold text-foreground">
					{t.menuSectionTitle}
				</h2>
			</div>
			<p class="text-xs text-muted-foreground">
				{t.menuSectionDesc}
			</p>
		</div>

		<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
			<!-- Victim Registration -->
			<PublicQuickServiceCard
				title={t.regTitle}
				badge={t.regBadge}
				badgeClass="bg-danger-muted text-danger"
				description={t.regDesc}
				icon={ShieldAlert}
				iconClass="bg-danger-muted/30 text-danger"
			>
				<PublicActionBtn onclick={() => (bookingOpen = true)}>{t.regBtn}</PublicActionBtn>
			</PublicQuickServiceCard>

			<!-- For Donors / Donations -->
			<PublicQuickServiceCard
				title={t.donateTitle}
				badge={t.donateBadge}
				badgeClass="bg-primary-muted text-primary"
				description={t.donateDesc}
				icon={Package}
				iconClass="bg-primary-muted/50 text-primary"
			>
				<PublicActionBtn href="/donations">{t.donateBtn1}</PublicActionBtn>
				<PublicActionBtn variant="outline" disabled>{t.donateBtn2}</PublicActionBtn>
			</PublicQuickServiceCard>

			<!-- For Volunteers -->
			<div>
				<PublicQuickServiceCard
					title={t.volTitle}
					badge={t.volBadge}
					badgeClass="bg-chart-2/15 text-chart-2"
					description={t.volDesc}
					icon={UserPlus}
					iconClass="bg-chart-2/15 text-chart-2"
				>
					<PublicActionBtn disabled>{t.volBtn}</PublicActionBtn>
				</PublicQuickServiceCard>
			</div>

			<!-- Urgent Person Search -->
			<PublicQuickServiceCard
				title={t.searchTitle}
				badge={t.searchBadge}
				badgeClass="bg-accent-purple-muted text-accent-purple"
				description={t.searchDesc}
				icon={Search}
				iconClass="bg-accent-purple-muted/50 text-accent-purple"
			>
				<PublicActionBtn onclick={() => (searchOpen = true)}>{t.searchBtn}</PublicActionBtn>
			</PublicQuickServiceCard>
		</div>
	</section>

	<!-- 4. Help Center & Emergency Contacts -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<!-- Help Center (EOC Help Center & FAQ) -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
			<div class="mb-2 flex items-center gap-2">
				<div
					class="flex h-7 w-7 items-center justify-center rounded-full bg-primary-muted text-primary"
				>
					<HelpCircle class="h-4 w-4" />
				</div>
				<h2 class="text-lg font-bold text-foreground">
					{t.faqTitle}
				</h2>
			</div>

			<p class="mb-5 text-sm text-muted-foreground">
				{t.faqDesc}
			</p>

			<div class="flex flex-col gap-4">
				<Accordion.Root type="single">
					{#each data.faqs as faq, i (faq.id || i)}
						<Accordion.Item
							value="item-{i}"
							class="mb-3 rounded-xl border border-border px-4 py-2 shadow-sm"
						>
							<Accordion.Trigger class="text-left hover:no-underline">
								<div class="flex items-center gap-3">
									<div
										class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-dark text-xs font-bold text-white"
									>
										{i + 1}
									</div>
									<span class="text-sm font-bold">
										{langState.current === 'en' && faq.question_en ? faq.question_en : faq.question}
									</span>
								</div>
							</Accordion.Trigger>
							<Accordion.Content
								class="pt-2 text-sm leading-relaxed whitespace-pre-line text-muted-foreground"
							>
								{langState.current === 'en' && faq.answer_en ? faq.answer_en : faq.answer}
							</Accordion.Content>
						</Accordion.Item>
					{:else}
						<div class="py-4 text-center text-sm text-muted-foreground">
							{t.faqEmpty}
						</div>
					{/each}
				</Accordion.Root>

				<a
					href="/shelters"
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-muted/30 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary-muted/50"
				>
					<MapPin class="h-4 w-4" />
					{t.faqLink}
					<ExternalLink class="h-3 w-3" />
				</a>
			</div>
		</div>

		<!-- Emergency and Urgent Contacts -->
		<div
			class="flex h-fit flex-col justify-center rounded-2xl bg-[#1e293b] p-6 text-white shadow-sm lg:p-8"
		>
			<div
				class="mb-4 inline-flex w-fit items-center rounded-full bg-white/10 px-3 py-1 text-xs font-bold tracking-wider text-white"
			>
				{t.contactStandby}
			</div>

			<div class="mb-3 flex items-start gap-3">
				<PhoneCall class="mt-1 h-6 w-6 shrink-0 text-chart-2" />
				<h2 class="text-xl leading-tight font-bold">
					{t.contactTitle}
				</h2>
			</div>
			<p class="mb-6 text-sm leading-relaxed text-white/70">
				{t.contactDesc}
			</p>

			<div class="flex flex-col gap-3">
				<!-- Call 1669 -->
				<a
					href="tel:1669"
					class="flex items-center justify-between rounded-xl bg-danger px-5 py-4 font-bold transition-colors hover:bg-danger/90"
				>
					<div class="flex items-center gap-3">
						<div
							class="flex h-5 w-5 items-center justify-center rounded-full border border-white text-xs"
						>
							i
						</div>
						<span class="text-base text-white">{t.call} 1669</span>
					</div>
					<span class="rounded-lg bg-black/20 px-3 py-1.5 text-2xs text-white"
						>{t.contact1669Label}</span
					>
				</a>

				<!-- Call 1784 -->
				<a
					href="tel:1784"
					class="flex items-center justify-between rounded-xl bg-warning px-5 py-4 font-bold transition-colors hover:bg-[#b45309]"
				>
					<div class="flex items-center gap-3">
						<PhoneCall class="h-4 w-4 text-white" />
						<span class="text-base text-white">{t.call} 1784</span>
					</div>
					<span class="rounded-lg bg-black/20 px-3 py-1.5 text-2xs text-white"
						>{t.contact1784Label}</span
					>
				</a>

				{#if data.configData?.phone_number || data.configData?.line_oa_url || data.configData?.facebook_url}
					<div class="mt-4 border-t border-white/10 pt-4">
						<h3 class="mb-3 text-sm font-bold text-white/90">{t.moreInfo}</h3>
						<div class="flex flex-col gap-2">
							{#if data.configData?.phone_number}
								<a
									href="tel:{data.configData.phone_number}"
									class="flex items-center justify-between rounded-xl bg-white/10 px-5 py-3 font-bold transition-colors hover:bg-white/20"
								>
									<div class="flex items-center gap-3">
										<PhoneCall class="h-4 w-4 text-white" />
										<span class="text-sm text-white">{t.call} {data.configData.phone_number}</span>
									</div>
									<span class="rounded-lg bg-black/20 px-3 py-1 text-2xs text-white"
										>{t.directLine}</span
									>
								</a>
							{/if}
							{#if data.configData?.line_oa_url}
								<a
									href={String(data.configData.line_oa_url)}
									target="_blank"
									rel="noopener noreferrer"
									class="flex items-center justify-between rounded-xl bg-[#00B900] px-5 py-3 font-bold transition-colors hover:bg-[#009900]"
								>
									<div class="flex items-center gap-3">
										<MessageCircle class="h-4 w-4 text-white" />
										<span class="text-sm text-white">LINE Official</span>
									</div>
								</a>
							{/if}
							{#if data.configData?.facebook_url}
								<a
									href={String(data.configData.facebook_url)}
									target="_blank"
									rel="noopener noreferrer"
									class="flex items-center justify-between rounded-xl bg-[#1877F2] px-5 py-3 font-bold transition-colors hover:bg-[#166FE5]"
								>
									<div class="flex items-center gap-3">
										<ExternalLink class="h-4 w-4 text-white" />
										<span class="text-sm text-white">Facebook Page</span>
									</div>
								</a>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</PublicPageShell>

<BookingModal bind:open={bookingOpen} />
<FamilySearchModal bind:open={searchOpen} />
