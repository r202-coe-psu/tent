<script lang="ts">
	import { page } from '$app/state';
	import Building from '@lucide/svelte/icons/building';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Mail from '@lucide/svelte/icons/mail';

	export interface PublicFooterConfig {
		line_oa_url?: string;
		facebook_url?: string;
	}

	interface Props {
		configData?: PublicFooterConfig;
	}

	let { configData }: Props = $props();

	const pageConfig = $derived(page.data?.configData as PublicFooterConfig | undefined);

	const effectiveConfig = $derived<PublicFooterConfig>({
		line_oa_url: configData?.line_oa_url || pageConfig?.line_oa_url || '',
		facebook_url: configData?.facebook_url || pageConfig?.facebook_url || ''
	});

	const hasLineOa = $derived(Boolean(effectiveConfig.line_oa_url?.trim()));
	const hasFacebook = $derived(Boolean(effectiveConfig.facebook_url?.trim()));
	const hasOnlineChannels = $derived(hasLineOa || hasFacebook);
</script>

<footer class="border-t border-[#0A2647] bg-[#0A2647] text-white antialiased">
	<div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
		<div class="grid grid-cols-1 gap-8 md:grid-cols-12">
			<!-- Column 1: Platform Branding -->
			<div class="space-y-3 {hasOnlineChannels ? 'md:col-span-5' : 'md:col-span-7'}">
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
						href="mailto:Thamathep.l@psu.ac.th"
						class="transition-colors hover:text-white hover:underline"
					>
						Thamathip.l@psu.ac.th
					</a>
				</div>
				<p class="text-xs text-white/60">ระบบประสานงานและข้อมูลสาธารณะเพื่อการบรรเทาทุกข์</p>
			</div>

			<!-- Column 2: Emergency Numbers -->
			<div class="space-y-3 {hasOnlineChannels ? 'md:col-span-4' : 'md:col-span-5'}">
				<h4 class="text-xs font-semibold text-white/80">เบอร์ติดต่อฉุกเฉิน</h4>
				<div class="space-y-2 text-xs">
					<div
						class="flex items-center justify-between border-b border-white/10 pb-2 text-white/90"
					>
						<div class="flex items-center gap-2">
							<span class="text-xs select-none">🚨</span>
							<span>ศูนย์เตือนภัย ปภ.</span>
						</div>
						<a href="tel:1784" class="font-mono font-bold text-white hover:underline">1784</a>
					</div>
					<div class="flex items-center justify-between pt-0.5 text-white/90">
						<div class="flex items-center gap-2">
							<span class="text-xs select-none">🚑</span>
							<span>สายด่วนกู้ชีพ</span>
						</div>
						<a href="tel:1669" class="font-mono font-bold text-white hover:underline">1669</a>
					</div>
				</div>
			</div>

			<!-- Column 3: Fast Online Channels -->
			{#if hasOnlineChannels}
				<div class="space-y-3 md:col-span-3">
					<h4 class="text-xs font-semibold text-white/80">ช่องทางออนไลน์ด่วน</h4>
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
									<span>LINE OA ฉุกเฉิน</span>
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
									<span>Facebook ข่าวสาร EOC</span>
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
				© 2026 SmartShelter • คุ้มครองข้อมูลตาม พ.ร.บ. PDPA •
				ปฏิบัติการร่วมศูนย์ประสานงานช่วยเหลือผู้ประสบภัย
			</p>
		</div>
	</div>
</footer>
