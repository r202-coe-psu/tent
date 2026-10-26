<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Mail from '@lucide/svelte/icons/mail';
	import {
		PUBLIC_COOKIE_I18N,
		PUBLIC_FOOTER_I18N,
		PUBLIC_POLICY_I18N,
		PUBLIC_TERM_I18N
	} from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import type { PublicFooterLogo } from '$lib/features/public-portal';

	export interface PublicFooterConfig {
		line_oa_url?: string;
		facebook_url?: string;
		footer_logos?: PublicFooterLogo[];
	}

	interface Props {
		configData?: PublicFooterConfig;
	}

	let { configData }: Props = $props();

	const pageConfig = $derived(page.data?.configData as PublicFooterConfig | undefined);

	const effectiveConfig = $derived<PublicFooterConfig>({
		line_oa_url: configData?.line_oa_url || pageConfig?.line_oa_url || '',
		facebook_url: configData?.facebook_url || pageConfig?.facebook_url || '',
		footer_logos: configData?.footer_logos ?? pageConfig?.footer_logos ?? []
	});

	const footerLogos = $derived(effectiveConfig.footer_logos ?? []);
	const logoAlt = (logo: PublicFooterLogo) =>
		langState.current === 'en' && logo.alt_en ? logo.alt_en : logo.alt_th;

	const hasLineOa = $derived(Boolean(effectiveConfig.line_oa_url?.trim()));
	const hasFacebook = $derived(Boolean(effectiveConfig.facebook_url?.trim()));
	const hasOnlineChannels = $derived(hasLineOa || hasFacebook);

	const t = $derived(getTranslation(PUBLIC_FOOTER_I18N, langState.current));
	const termT = $derived(getTranslation(PUBLIC_TERM_I18N, langState.current));
	const cookieT = $derived(getTranslation(PUBLIC_COOKIE_I18N, langState.current));
	const policyT = $derived(getTranslation(PUBLIC_POLICY_I18N, langState.current));
</script>

<!-- Partner Logos (config:public_portal.footer_logos) — light band above the footer -->
{#if footerLogos.length > 0}
	<section
		aria-labelledby="footer-partners-heading"
		class="border-t border-slate-200/80 bg-[#F8FAFC]"
	>
		<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<h2 id="footer-partners-heading" class="text-center text-sm font-semibold text-slate-500">
				{t.partners}
			</h2>
			<ul class="mt-4 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
				{#each footerLogos as logo (logo.id)}
					{@const alt = logoAlt(logo)}
					<li>
						{#snippet logoImage()}
							<img
								src={logo.image_url}
								{alt}
								title={alt}
								loading="lazy"
								class="h-12 w-auto max-w-44 object-contain"
							/>
						{/snippet}
						{#if logo.link_url}
							<a
								href={logo.link_url}
								target="_blank"
								rel="noopener noreferrer"
								class="flex h-20 min-w-32 items-center justify-center rounded-xl border border-slate-200/80 bg-white px-5 py-3 shadow-2xs transition-colors hover:border-slate-300 hover:shadow-xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
							>
								{@render logoImage()}
								<span class="sr-only">
									({langState.current === 'en' ? 'opens in new tab' : 'เปิดในหน้าต่างใหม่'})</span
								>
							</a>
						{:else}
							<div
								class="flex h-20 min-w-32 items-center justify-center rounded-xl border border-slate-200/80 bg-white px-5 py-3 shadow-2xs"
							>
								{@render logoImage()}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	</section>
{/if}

<footer class="border-t border-[#0A2647] bg-[#0A2647] text-white antialiased">
	<div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
		<div class="grid grid-cols-1 gap-8 md:grid-cols-12">
			<!-- Column 1: Platform Branding -->
			<div class="space-y-3 {hasOnlineChannels ? 'md:col-span-5' : 'md:col-span-7'}">
				<div class="flex items-center gap-2.5">
					<img
						src="/logo.png"
						alt="PSU Smart Shelter"
						class="h-8 w-8 shrink-0 rounded-lg object-contain"
					/>
					<h3 class="text-sm font-bold text-white">Smart Shelter Platform</h3>
				</div>
				<div class="flex items-center gap-2 text-xs text-white/80">
					<Mail class="h-3.5 w-3.5 shrink-0 text-white/60" />
					<a
						href="mailto:Thanathip.l@psu.ac.th"
						class="transition-colors hover:text-white hover:underline"
					>
						Thanathip.l@psu.ac.th
					</a>
				</div>
				<p class="text-xs text-white/60">{t.tagline}</p>
			</div>

			<!-- Column 2: Emergency Numbers -->
			<div class="space-y-3 {hasOnlineChannels ? 'md:col-span-4' : 'md:col-span-5'}">
				<h4 class="text-xs font-semibold text-white/80">{t.emergencyNumbers}</h4>
				<div class="space-y-2 text-xs">
					<div
						class="flex items-center justify-between border-b border-white/10 pb-2 text-white/90"
					>
						<div class="flex items-center gap-2">
							<span class="text-xs select-none">🚨</span>
							<span>{t.disasterWarning}</span>
						</div>
						<a href="tel:1784" class="font-mono font-bold text-white hover:underline">1784</a>
					</div>
					<div class="flex items-center justify-between pt-0.5 text-white/90">
						<div class="flex items-center gap-2">
							<span class="text-xs select-none">🚑</span>
							<span>{t.rescueHotline}</span>
						</div>
						<a href="tel:1669" class="font-mono font-bold text-white hover:underline">1669</a>
					</div>
				</div>
			</div>

			<!-- Column 3: Fast Online Channels -->
			{#if hasOnlineChannels}
				<div class="space-y-3 md:col-span-3">
					<h4 class="text-xs font-semibold text-white/80">{t.onlineChannels}</h4>
					<div class="space-y-2">
						{#if hasLineOa}
							<a
								href={effectiveConfig.line_oa_url}
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center justify-between rounded-lg border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-white/15"
							>
								<div class="flex items-center gap-2">
									<span class="h-2 w-2 rounded-full bg-emerald-400"></span>
									<span>{t.lineOa}</span>
								</div>
								<ExternalLink class="h-3.5 w-3.5 text-slate-400" />
							</a>
						{/if}
						{#if hasFacebook}
							<a
								href={effectiveConfig.facebook_url}
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center justify-between rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/15"
							>
								<div class="flex items-center gap-2">
									<span class="h-2 w-2 rounded-full bg-sky-400"></span>
									<span>{t.facebook}</span>
								</div>
								<ExternalLink class="h-3.5 w-3.5 text-slate-400" />
							</a>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Bottom Copyright Bar -->
		<div class="mt-8 border-t border-white/10 pt-6 text-center text-xs text-white/60">
			<p>
				{t.copyright}
			</p>
			<p class="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
				<a
					href={resolve('/policy')}
					class="underline-offset-2 transition-colors hover:text-white hover:underline"
				>
					{policyT.footerLink}
				</a>
				<span class="text-white/30" aria-hidden="true">·</span>
				<a
					href={resolve('/term')}
					class="underline-offset-2 transition-colors hover:text-white hover:underline"
				>
					{termT.footerLink}
				</a>
				<span class="text-white/30" aria-hidden="true">·</span>
				<a
					href={resolve('/cookie')}
					class="underline-offset-2 transition-colors hover:text-white hover:underline"
				>
					{cookieT.footerLink}
				</a>
			</p>
		</div>
	</div>
</footer>
