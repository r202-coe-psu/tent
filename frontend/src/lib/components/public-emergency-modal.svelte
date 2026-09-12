<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Bell from '@lucide/svelte/icons/bell';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import PublicEmergencyBanner from '$lib/components/public-emergency-banner.svelte';
	import type { Announcement } from '$lib/features/announcements';

	interface Props {
		open?: boolean;
		announcements?: Announcement[];
	}

	let { open = $bindable(false), announcements = [] }: Props = $props();

	const emergencyCount = $derived(announcements.filter((a) => a.severity === 'emergency').length);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header class="border-b border-slate-100 pb-3 text-left">
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl {emergencyCount > 0
						? 'border border-red-200 bg-red-50 text-red-600'
						: 'border border-sky-200 bg-sky-50 text-[#0284C7]'}"
				>
					{#if emergencyCount > 0}
						<ShieldAlert class="h-5 w-5" />
					{:else}
						<Bell class="h-5 w-5" />
					{/if}
				</div>
				<div class="space-y-0.5">
					<Dialog.Title class="text-base font-bold text-slate-900 sm:text-lg">
						ประกาศแจ้งเตือนภัยฉุกเฉิน
					</Dialog.Title>
					<Dialog.Description class="text-xs text-slate-500">
						ข้อมูลและประกาศสถานการณ์เร่งด่วนจากศูนย์บัญชาการสถานการณ์ (EOC)
					</Dialog.Description>
				</div>
			</div>
		</Dialog.Header>

		<div class="mt-4 flex flex-col gap-6">
			{#if announcements.length > 0}
				{#each announcements as announcement (announcement._id)}
					<PublicEmergencyBanner {announcement} class="mb-0 shadow-sm" />
				{/each}
			{:else}
				<div
					class="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-slate-500"
				>
					<p class="text-sm font-medium">ไม่มีประกาศแจ้งเตือนภัยในขณะนี้</p>
					<p class="mt-1 text-xs text-slate-400">
						สถานการณ์ปกติ ทุกศูนย์พักพิงเปิดให้บริการตามปกติ
					</p>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
