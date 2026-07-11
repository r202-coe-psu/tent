<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { Component } from 'svelte';

	let {
		title = 'ระบบข้อมูลผู้ประสบภัยและ<br/>สืบค้นสถานะเข้าพักฉุกเฉิน',
		description = 'เชื่อมต่อ อำนวยความสะดวก และรายงานความช่วยเหลือสาธารณะเพื่อความโปร่งใสแบบตามเวลาจริง (Real-Time Transparency) สามารถสืบหาญาติ ติดตามผู้ประสบภัย หรือร่วมแจกจ่ายเสบียงผ่านเครือข่ายของเรา',
		badgeText = 'LIVE DISASTER COORDINATION LINK',
		badgeIcon: BadgeIcon = null,
		showLivePing = true,
		bgClass = 'bg-primary',
		showSearch = true,

		summary,
		flags,
		lastUpdated,
		isStale
	}: {
		title?: string;
		description?: string;
		badgeText?: string;
		badgeIcon?: Component | null;
		showLivePing?: boolean;
		bgClass?: string;
		showSearch?: boolean;

		summary?: {
			shelters_open: number;
			shelters_total: number;
			occupancy_total: number;
			vulnerable_count: number;
		};
		flags?: { public_metrics_occupancy: boolean; public_metrics_vulnerable: boolean };
		lastUpdated?: number;
		isStale?: boolean;
	} = $props();

	import { goto } from '$app/navigation';

	let searchQuery = $state('');

	function handleSearch() {
		if (searchQuery.trim()) {
			goto(`/public/search?q=${encodeURIComponent(searchQuery.trim())}`);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleSearch();
	}
</script>

<div class="mb-8 overflow-hidden rounded-2xl {bgClass} relative p-8 text-white shadow-lg lg:p-12">
	<div
		class="absolute inset-0 opacity-10"
		style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 24px 24px;"
	></div>
	<div class="relative flex flex-col gap-10 md:flex-row">
		<!-- Text Content -->
		<div class="flex flex-col justify-center">
			<div
				class="mb-4 inline-flex w-fit items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wider text-white/90 uppercase backdrop-blur-sm"
			>
				{#if showLivePing}
					<span class="relative flex h-2 w-2">
						<span
							class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"
						></span>
						<span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
					</span>
				{/if}
				{#if BadgeIcon}
					<BadgeIcon class="h-4 w-4" />
				{/if}
				{badgeText}
			</div>
			<h1
				class="mb-4 text-3xl leading-tight font-bold tracking-tight text-white md:text-4xl lg:text-5xl"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html title}
			</h1>
			<p class="max-w-2xl text-base text-white/80 md:text-lg {showSearch ? 'mb-8' : ''}">
				{description}
			</p>

			{#if showSearch}
				<div
					class="mt-2 flex w-full max-w-xl flex-col justify-between gap-2 rounded-xl bg-white p-2 sm:flex-row sm:items-center"
				>
					<div class="relative flex w-full flex-1 items-center gap-3 pl-2">
						<Search class="text-bold size-5 shrink-0 text-muted-foreground" />
						<input
							type="text"
							bind:value={searchQuery}
							onkeydown={handleKeydown}
							placeholder="สืบค้นญาติด้วย ชื่อ-สกุล หรือ รหัสบัตรประชาชน"
							class="h-10 w-full bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
						/>
					</div>
					<Button
						onclick={handleSearch}
						class="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-strong px-6 py-2 text-xs font-bold text-white transition-colors hover:bg-primary"
					>
						ค้นหาญาติตอนนี้
					</Button>
				</div>
			{/if}
		</div>

		<!-- Metrics Panel -->
		{#if summary && flags && lastUpdated !== undefined && isStale !== undefined}
			<div class="flex flex-col justify-center">
				<div class="relative rounded-2xl border border-border bg-card p-6 shadow-xl">
					<!-- Stale Warning -->
					{#if isStale}
						<div
							class="absolute -top-3 right-6 flex items-center gap-1 rounded-full border-2 border-white bg-warning px-3 py-1 text-[10px] font-bold text-white shadow-sm"
						>
							<AlertCircle class="h-3 w-3" /> ข้อมูลอาจไม่เป็นปัจจุบัน
						</div>
					{/if}

					<div class=" flex items-center justify-between border-b border-border/50 pb-4">
						<h3 class="text-xs font-bold tracking-wider text-card-foreground uppercase">
							สถานการณ์ปัจจุบัน ณ ขณะนี้ (Real-Time Metrics)
						</h3>
						<span class="text-[10px] text-muted-foreground"
							>อัปเดตล่าสุด: {new Date(lastUpdated).toLocaleTimeString('th-TH')}</span
						>
					</div>

					<div class="mt-4 grid grid-cols-2 gap-4">
						<!-- Metric 1 -->
						<div
							class="flex flex-col justify-center rounded-xl border border-border/50 bg-muted/30 p-4"
						>
							<span class="mb-2 text-xs font-semibold text-muted-foreground"
								>ศูนย์พักพิงพร้อมให้บริการ</span
							>
							<div class="flex items-baseline gap-1">
								<span class="text-3xl font-bold text-card-foreground">{summary?.shelters_open ?? '-'}</span>
								<span class="text-sm font-medium text-muted-foreground"
									>/{summary?.shelters_total ?? '-'} แห่ง</span
								>
							</div>
						</div>

						<!-- Metric 2 (Occupancy) -->
						{#if flags.public_metrics_occupancy}
							<div
								class="flex flex-col justify-center rounded-xl border border-border/50 bg-muted/30 p-4"
							>
								<span class="mb-2 text-xs font-semibold text-muted-foreground"
									>ผู้ประสบภัยปลอดภัย</span
								>
								<div class="flex items-baseline gap-1">
									<span class="text-3xl font-bold text-card-foreground"
										>{summary?.occupancy_total ?? '-'}</span
									>
									<span class="text-sm font-medium text-muted-foreground">คน</span>
								</div>
							</div>
						{/if}
					</div>

					<!-- Metric 3 (Vulnerable) -->
					{#if flags.public_metrics_vulnerable}
						<div
							class="mt-4 flex items-center justify-between rounded-xl border border-border/50 bg-muted/30 p-4"
						>
							<div>
								<span class="mb-2 block text-xs font-semibold text-muted-foreground"
									>กลุ่มเปราะบาง (เด็กและผู้สูงอายุ)</span
								>
								<div class="flex items-baseline gap-1">
									<span class="text-3xl font-bold text-card-foreground"
										>{summary?.vulnerable_count ?? '-'}</span
									>
									<span class="text-sm font-medium text-muted-foreground">คน</span>
								</div>
							</div>
							<div
								class="flex h-fit items-center rounded-lg bg-danger-muted/50 px-3 py-1.5 text-xs font-bold text-danger"
							>
								VULNERABLE
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
