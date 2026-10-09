<script lang="ts">
	import { resolve } from '$app/paths';
	import Building from '@lucide/svelte/icons/building';
	import Mail from '@lucide/svelte/icons/mail';
	import { PUBLIC_FOOTER_I18N, PUBLIC_POLICY_I18N, PUBLIC_TERM_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	export interface PublicFooterConfig {
		line_oa_url?: string;
		facebook_url?: string;
	}

	interface Props {
		configData?: PublicFooterConfig;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let { configData = undefined }: Props = $props();

	const t = $derived(getTranslation(PUBLIC_FOOTER_I18N, langState.current));
	const termT = $derived(getTranslation(PUBLIC_TERM_I18N, langState.current));
	const policyT = $derived(getTranslation(PUBLIC_POLICY_I18N, langState.current));
</script>

<footer class="border-t border-[#0A2647] bg-[#0A2647] text-white antialiased">
	<div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
		<div class="grid grid-cols-1 gap-8 md:grid-cols-12">
			<!-- Column 1: Platform Branding -->
			<div class="space-y-3 md:col-span-7">
				<div class="flex items-center gap-2.5">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm"
					>
						<Building class="h-4 w-4" />
					</div>
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
			<div class="space-y-3 md:col-span-5">
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
			</p>
		</div>
	</div>
</footer>
