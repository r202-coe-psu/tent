<script lang="ts">
	import type { PageData } from './$types';
	import { FooterLogosSection } from '$lib/features/public-portal';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import ExternalLink from '@lucide/svelte/icons/external-link';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.title} - Smart Shelter</title>
</svelte:head>

<StaffPageShell
	title={data.title}
	description="จัดการโลโก้หน่วยงานที่สนับสนุนที่แสดงที่ส่วนท้ายของหน้าเว็บสาธารณะ"
>
	<div class={spatial.container.staffPageCard}>
		<div class="mb-4 flex justify-end">
			<a
				href="/"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-[#0A2647] transition-colors hover:bg-sky-100"
			>
				<ExternalLink class="size-3" />
				ดูการแสดงผลหน้าบ้าน
			</a>
		</div>
		<FooterLogosSection logos={data.footerLogos} rev={data.configRev} canEdit={data.canEditLogos} />
	</div>
</StaffPageShell>
