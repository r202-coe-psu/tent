<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import { langState } from '$lib/states/i18n.svelte';

	export type PublicDonationCardData = {
		id: string;
		name: string;
		status: string;
		location: string;
		needs: string[];
		receivedPercent: number;
		deficitText: string;
		href?: string;
	};

	let {
		item,
		class: customClass = ''
	}: {
		item: PublicDonationCardData;
		class?: string;
	} = $props();

	const targetHref = $derived(item.href || `/donations?shelter=${item.id}`);
	const isEn = $derived(langState.current === 'en');
	const displayStatus = $derived(
		isEn ? (item.status === 'วิกฤติ' ? 'Critical' : item.status) : item.status
	);
</script>

<div
	class="flex flex-col justify-between rounded-[22px] border-2 border-[#FEF08A] bg-white p-4 shadow-2xs transition-all hover:border-amber-300 sm:rounded-[28px] sm:p-7 {customClass ||
		'w-[86%] max-w-[340px] min-w-[270px] shrink-0 snap-start sm:w-[420px] sm:max-w-none sm:min-w-0 md:w-[460px] lg:w-[480px]'}"
>
	<div class="space-y-2.5 sm:space-y-5">
		<!-- Header: Name & Urgency Status -->
		<div class="flex items-start justify-between gap-2.5 sm:gap-3.5">
			<h3 class="line-clamp-2 text-base leading-snug font-bold text-slate-900 sm:text-xl">
				{item.name}
			</h3>
			<span
				class="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-[#FFF1F2] px-2.5 py-0.5 text-[11px] font-semibold text-[#E11D48] sm:gap-1.5 sm:px-3.5 sm:py-1 sm:text-xs"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-[#E11D48]"></span>
				{displayStatus}
			</span>
		</div>

		<!-- Location -->
		<div class="flex items-center gap-1.5 text-xs text-slate-500 sm:gap-2 sm:text-sm">
			<MapPin class="h-3.5 w-3.5 shrink-0 text-slate-400 sm:h-4 sm:w-4" />
			<span class="truncate">{item.location}</span>
		</div>

		<!-- Items Needed Tags -->
		<div class="space-y-1.5 pt-0.5 sm:space-y-3 sm:pt-1">
			<div class="text-[11px] font-semibold text-slate-700 sm:text-sm">
				{isEn ? 'Urgent items needed:' : 'สิ่งของจำเป็นที่ขาดแคลน:'}
			</div>
			<div class="flex flex-wrap gap-1.5 sm:gap-2">
				{#each item.needs as need, idx (idx)}
					<span
						class="{idx >= 3
							? 'hidden sm:inline-flex'
							: 'inline-flex'} rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1 text-[11px] font-medium text-[#92400E] sm:rounded-xl sm:px-3.5 sm:py-1.5 sm:text-sm"
					>
						{need}
					</span>
				{/each}
				{#if item.needs.length > 3}
					<span
						class="inline-flex items-center rounded-lg border border-dashed border-amber-300 bg-amber-50/70 px-2 py-0.5 text-[11px] font-semibold text-amber-800 sm:hidden"
					>
						+{item.needs.length - 3}
						{isEn ? 'more' : 'รายการ'}
					</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Progress Bar and Donation CTA -->
	<div class="mt-3.5 space-y-3 pt-1 sm:mt-6 sm:space-y-5 sm:pt-2">
		<div class="space-y-1.5 sm:space-y-2.5">
			<div class="flex items-center justify-between text-xs sm:text-sm">
				<span class="text-xs font-bold text-slate-900 sm:text-base">
					{isEn ? `Received ${item.receivedPercent}%` : `ได้รับแล้ว ${item.receivedPercent}%`}
				</span>
				<span class="text-[11px] font-normal text-slate-500 sm:text-sm">
					({item.deficitText})
				</span>
			</div>
			<div class="h-2.5 w-full overflow-hidden rounded-full bg-[#F1F5F9] sm:h-4">
				<div
					class="h-full rounded-full bg-[#FF5C00] transition-all duration-500"
					style="width: {item.receivedPercent}%"
				></div>
			</div>
		</div>

		<a
			href={targetHref}
			class="flex w-full cursor-pointer items-center justify-center rounded-xl bg-[#FF5C00] py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#E05200] sm:rounded-2xl sm:py-4 sm:text-base"
		>
			{isEn ? 'Donate' : 'แจ้งบริจาค'}
		</a>
	</div>
</div>
