<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Utensils from '@lucide/svelte/icons/utensils';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Check from '@lucide/svelte/icons/check';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { resolve } from '$app/paths';
	import { setMealsStore } from '../application/meal-distribution-store.svelte';
	import { useShelters } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import SessionOverview from './session-overview.svelte';
	import KioskPanel from './kiosk-panel.svelte';
	import ScannerDialog from './scanner-dialog.svelte';
	import CloseBatchDialog from './close-batch-dialog.svelte';
	import MenuHistoryDialog from './menu-history-dialog.svelte';

	const store = setMealsStore();
	const sheltersQuery = useShelters();

	const selectedShelterCode = $derived(shelterStore.selectedShelterCode ?? 'all');
	const currentShelterName = $derived.by(() => {
		if (!selectedShelterCode || selectedShelterCode === 'all') {
			return 'ภาพรวมทุกศูนย์พักพิง';
		}
		const match = sheltersQuery.data?.find((s) => s.code === selectedShelterCode);
		return match ? match.name : selectedShelterCode;
	});

	function handleShelterChange(val: string | undefined) {
		if (!val || val === 'all') {
			shelterStore.selectedShelterCode = undefined;
		} else {
			shelterStore.selectedShelterCode = val;
		}
	}

	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen().catch(() => {});
		} else {
			document.exitFullscreen().catch(() => {});
		}
	}
</script>

<div class="min-h-screen w-full bg-[#f4f7fa] text-slate-800 dark:bg-zinc-950 dark:text-slate-200">
	<div class="mx-auto w-full max-w-7xl p-4 md:p-6">
		<!-- Sub-Header Card -->
		<div
			class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
		>
			<div class="flex flex-col justify-between gap-4 md:flex-row md:items-center">
				<!-- Title -->
				<div class="flex flex-wrap items-center gap-3">
					{#if store.isKioskMode}
						<Button
							variant="secondary"
							size="sm"
							onclick={() => store.stopKiosk()}
							class="gap-1.5 text-xs font-semibold"
						>
							<ArrowLeft class="size-3.5" />
							<span>สลับเมนู / กลับหน้าเลือกรอบ</span>
						</Button>
					{:else}
						<Button
							variant="secondary"
							size="sm"
							href={resolve('/onsite')}
							class="gap-1.5 text-xs font-semibold"
						>
							<ArrowLeft class="size-3.5" />
							<span>กลับหน้ารวม</span>
						</Button>
					{/if}

					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-100 bg-amber-50 text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400"
						>
							<Utensils class="size-5" />
						</div>
						<h1
							class="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100"
						>
							<span>ระบบแจกจ่ายอาหารหน้างาน</span>
							<span class="text-sm font-medium text-slate-400 dark:text-slate-500"
								>(Active Meals Hub)</span
							>
						</h1>
					</div>

					<!-- Shelter Select Dropdown -->
					<Select.Root
						type="single"
						value={selectedShelterCode}
						onValueChange={handleShelterChange}
					>
						<Select.Trigger
							class="h-8 gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/80 px-3 text-xs font-bold text-amber-900 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50"
						>
							<Building2 class="size-3.5 text-amber-600 dark:text-amber-400" />
							<span class="max-w-[200px] truncate">{currentShelterName}</span>
						</Select.Trigger>
						<Select.Content align="start" class="w-[280px]">
							<Select.Group>
								<Select.Label class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
									เลือกศูนย์พักพิง (Shelter)
								</Select.Label>
								<Select.Item value="all" label="ภาพรวมทุกศูนย์พักพิง">
									🌐 ภาพรวมทุกศูนย์พักพิง (All Shelters)
								</Select.Item>
								{#each sheltersQuery.data ?? [] as shelter (shelter.code)}
									<Select.Item value={shelter.code} label={shelter.name}>
										🏢 {shelter.name}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Right Action Buttons & Stat Badges -->
				<div class="flex items-center gap-3 self-end md:self-center">
					<Badge
						variant="outline"
						class="gap-1.5 border-emerald-200/50 bg-emerald-50 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400"
					>
						<span class="size-1.5 rounded-full bg-emerald-500"></span>
						<span>มื้อที่เปิดแจก: {store.totalOpenSessions} มื้อ</span>
					</Badge>

					<Badge
						variant="outline"
						class="gap-1.5 border-amber-200/50 bg-amber-50 text-xs font-bold text-amber-800 dark:bg-amber-950/20 dark:text-amber-400"
					>
						<BarChart3 class="size-3" />
						<span>แจกแล้ววันนี้: {store.todayTotalServed} ที่</span>
					</Badge>

					<Button
						variant="outline"
						size="icon"
						class="border"
						onclick={toggleFullscreen}
						aria-label="ขยายเต็มจอ"
					>
						<Maximize2 class="size-4" />
					</Button>
				</div>
			</div>
		</div>

		{#if !store.isKioskMode}
			<div in:fade={{ duration: 150 }}>
				<SessionOverview />
			</div>
		{:else if store.activeKioskMenu}
			<div in:fade={{ duration: 150 }}>
				<KioskPanel />
			</div>
		{/if}
	</div>
</div>

<ScannerDialog />
<CloseBatchDialog />
<MenuHistoryDialog />

{#if store.showSuccessOverlay}
	<div
		transition:fade={{ duration: 100 }}
		role="status"
		aria-live="polite"
		class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/40"
	>
		<div
			transition:slide={{ duration: 180 }}
			class="flex max-w-sm flex-col items-center justify-center space-y-4 rounded-3xl bg-emerald-500 p-8 text-center text-white shadow-2xl"
		>
			<div class="flex size-16 animate-bounce items-center justify-center rounded-full bg-white/20">
				<Check class="size-10 text-white" />
			</div>
			<div>
				<h3 class="text-xl font-black">บันทึกแจกจ่ายสำเร็จ!</h3>
				<p class="mt-1 text-sm font-semibold opacity-90">{store.successMessage}</p>
				<p class="mt-0.5 text-xs opacity-75">
					ได้รับสิทธิ์อาหาร {store.activeKioskMenu?.title ?? ''} 1 ชุด
				</p>
			</div>
		</div>
	</div>
{/if}

{#if store.showWarningOverlay}
	<div
		transition:fade={{ duration: 100 }}
		role="alert"
		aria-live="assertive"
		class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/40"
	>
		<div
			transition:slide={{ duration: 180 }}
			class="flex max-w-sm flex-col items-center justify-center space-y-4 rounded-3xl bg-rose-600 p-8 text-center text-white shadow-2xl"
		>
			<div class="flex size-16 animate-pulse items-center justify-center rounded-full bg-white/20">
				<AlertTriangle class="size-10 text-white" />
			</div>
			<div>
				<h3 class="text-xl font-black">แจ้งเตือน: ตรวจพบการรับซ้ำ!</h3>
				<p class="mt-2 text-sm font-semibold opacity-95">{store.warningMessage}</p>
				<p class="mt-1 text-xs opacity-75">ไม่อนุญาตให้รับอาหารซ้ำในมื้อเดียวกัน</p>
			</div>
		</div>
	</div>
{/if}
