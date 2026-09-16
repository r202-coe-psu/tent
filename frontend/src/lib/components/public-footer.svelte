<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import FileText from '@lucide/svelte/icons/file-text';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Ambulance from '@lucide/svelte/icons/ambulance';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';

	export interface PublicFooterConfig {
		line_oa_url?: string;
		facebook_url?: string;
	}

	interface Props {
		configData?: PublicFooterConfig;
	}

	let { configData }: Props = $props();

	let fetchedConfig = $state<PublicFooterConfig | null>(null);

	const pageConfig = $derived(page.data?.configData as PublicFooterConfig | undefined);

	const effectiveConfig = $derived<PublicFooterConfig>({
		line_oa_url:
			configData?.line_oa_url || pageConfig?.line_oa_url || fetchedConfig?.line_oa_url || '',
		facebook_url:
			configData?.facebook_url || pageConfig?.facebook_url || fetchedConfig?.facebook_url || ''
	});

	onMount(async () => {
		if (
			!configData?.line_oa_url &&
			!configData?.facebook_url &&
			!pageConfig?.line_oa_url &&
			!pageConfig?.facebook_url
		) {
			try {
				const res = await fetch('/api/public/v1/config/faqs?category=public');
				if (res.ok) {
					const data = await res.json();
					fetchedConfig = {
						line_oa_url: data.line_oa_url || '',
						facebook_url: data.facebook_url || ''
					};
				}
			} catch (e) {
				console.error('Failed to fetch public config in footer', e);
			}
		}
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
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-sky-300">
						<FileText class="h-4 w-4" />
					</div>
					<h3 class="text-sm font-bold text-white">Smart Shelter Platform</h3>
				</div>
				<p class="text-xs font-medium text-white/90">
					ศูนย์อำนวยการร่วม EOC (ศูนย์ประสานงานช่วยเหลือผู้ประสบภัย)
				</p>
				<p class="text-xs text-white/60">
					ระบบพัฒนาเพื่อช่วยเหลือและจัดการศูนย์พักพิงในสถานการณ์อุทกภัยอย่างโปร่งใสและรวดเร็ว
				</p>
			</div>

			<!-- Column 2: Emergency Numbers (Only 1669 and 1784) -->
			<div class="space-y-3 {hasOnlineChannels ? 'md:col-span-4' : 'md:col-span-5'}">
				<h4 class="text-xs font-semibold text-white/80">เบอร์ติดต่อฉุกเฉิน</h4>
				<div class="space-y-2 text-xs">
					<div class="flex items-center justify-between text-white/90">
						<div class="flex items-center gap-2">
							<Ambulance class="h-3.5 w-3.5 text-red-400" />
							<span>สายด่วนกู้ชีพ</span>
						</div>
						<a href="tel:1669" class="font-mono font-bold text-red-300 hover:underline">1669</a>
					</div>
					<div class="flex items-center justify-between text-white/90">
						<div class="flex items-center gap-2">
							<ShieldAlert class="h-3.5 w-3.5 text-amber-400" />
							<span>ศูนย์เตือนภัย ปภ.</span>
						</div>
						<a href="tel:1784" class="font-mono font-bold text-amber-300 hover:underline">1784</a>
					</div>
				</div>
			</div>

			<!-- Column 3: Fast Online Channels (Show only if configured) -->
			{#if hasOnlineChannels}
				<div class="space-y-3 md:col-span-3">
					<h4 class="text-xs font-semibold text-white/80">ช่องทางออนไลน์ด่วน</h4>
					<div class="space-y-2">
						{#if hasLineOa}
							<a
								href={effectiveConfig.line_oa_url}
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center justify-between rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/15"
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
		<div class="mt-8 space-y-1 border-t border-white/10 pt-6 text-center text-xs text-white/60">
			<p>
				© 2026 Smart Shelter Project — มหาวิทยาลัยสงขลานครินทร์ • กรอบแผนงาน "น้ำมั่นคง ไม่ท่วม
				ไม่แล้ง" (ววน.)
			</p>
			<p>คุ้มครองข้อมูลตาม พ.ร.บ. PDPA • ปฏิบัติการร่วมศูนย์ประสานงานช่วยเหลือผู้ประสบภัย</p>
		</div>
	</div>
</footer>
