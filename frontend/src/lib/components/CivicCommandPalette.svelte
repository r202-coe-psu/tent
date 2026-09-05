<script lang="ts">
	import type { Component } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Package from '@lucide/svelte/icons/package';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Users from '@lucide/svelte/icons/users';
	import Bed from '@lucide/svelte/icons/bed';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';

	interface CommandItemType {
		id: string;
		title: string;
		subtitle?: string;
		group: 'records' | 'navigation' | 'actions';
		icon: Component<{ class?: string }>;
		shortcut?: string;
		action: () => void;
	}

	interface Props {
		open?: boolean;
		onselect?: (item: CommandItemType) => void;
	}

	let { open = $bindable(false), onselect }: Props = $props();

	let searchQuery = $state('');
	let selectedIndex = $state(0);

	const items: CommandItemType[] = [
		// Quick Actions
		{
			id: 'act-register',
			title: 'ลงทะเบียนผู้พักพิงใหม่',
			subtitle: 'บันทึกข้อมูลและออกรหัสประจำตัวผู้พักพิง',
			group: 'actions',
			icon: UserPlus,
			shortcut: '⌘N',
			action: () => {
				toast.success('เปิดแบบฟอร์มลงทะเบียนผู้พักพิงใหม่');
				open = false;
			}
		},
		{
			id: 'act-distribute',
			title: 'บันทึกแจกจ่ายถุงยังชีพ / สิ่งของ',
			subtitle: 'ตัดยอดสต็อกและผูกกับรหัสผู้รับ',
			group: 'actions',
			icon: Package,
			shortcut: '⌘D',
			action: () => {
				toast.info('เปิดหน้าบันทึกแจกจ่ายสิ่งของ');
				open = false;
			}
		},
		{
			id: 'act-emergency',
			title: 'ส่งสัญญาณแจ้งเตือนเหตุฉุกเฉิน',
			subtitle: 'บรอดแคสต์สถานะอพยพด่วนไปยังทุกเครื่อง',
			group: 'actions',
			icon: AlertTriangle,
			shortcut: '⌘E',
			action: () => {
				toast.error('เปิดกล่องส่งสัญญาณเตือนภัยฉุกเฉิน');
				open = false;
			}
		},
		{
			id: 'act-offline',
			title: 'สลับโหมดปฏิบัติการออฟไลน์ (CouchDB)',
			subtitle: 'เปลี่ยนระบบเป็น Remote-First Local DB ทันที',
			group: 'actions',
			icon: WifiOff,
			shortcut: '⌘O',
			action: () => {
				toast('สลับสถานะเป็นโหมดออฟไลน์แล้ว');
				open = false;
			}
		},

		// Navigation
		{
			id: 'nav-dashboard',
			title: 'แดชบอร์ดศูนย์พักพิง (Overview)',
			subtitle: 'ดูยอดผู้พักพิง ความจุเต็นท์ และทรัพยากรคงเหลือ',
			group: 'navigation',
			icon: LayoutDashboard,
			action: () => {
				toast.info('กำลังนำทางไปหน้าแดชบอร์ดภาพรวม');
				open = false;
			}
		},
		{
			id: 'nav-evacuees',
			title: 'ทะเบียนรายชื่อผู้พักพิง (Evacuees List)',
			subtitle: 'ค้นหา ตรวจสอบสถานะ และประวัติการรักษาพยาบาล',
			group: 'navigation',
			icon: Users,
			action: () => {
				toast.info('กำลังนำทางไปหน้ารายชื่อผู้พักพิง');
				open = false;
			}
		},
		{
			id: 'nav-zones',
			title: 'แผนผังและสถิติเตียงพัก (Bed Allocation)',
			subtitle: 'ตรวจสอบเต็นท์ โซน A-D และเตียงว่าง',
			group: 'navigation',
			icon: Bed,
			action: () => {
				toast.info('กำลังนำทางไปหน้าแผนผังเต็นท์');
				open = false;
			}
		},

		// Records
		{
			id: 'rec-1',
			title: 'สมชาย ใจดี (อายุ 45 ปี)',
			subtitle: 'เต็นท์ โซน A (A-12) • CID: 1-5099-00123-45-6',
			group: 'records',
			icon: Users,
			action: () => {
				toast.success('เปิดข้อมูลผู้พักพิง: สมชาย ใจดี');
				open = false;
			}
		},
		{
			id: 'rec-2',
			title: 'กัญญารัตน์ สุขสวัสดิ์ (ผู้ป่วยติดเตียง)',
			subtitle: 'เต็นท์ พยาบาลฉุกเฉิน (M-02) • ต้องการออกซิเจน',
			group: 'records',
			icon: HeartPulse,
			action: () => {
				toast.info('เปิดข้อมูลผู้ป่วยพิเศษ: กัญญารัตน์ สุขสวัสดิ์');
				open = false;
			}
		},
		{
			id: 'rec-3',
			title: 'เต็นท์พยาบาลสนาม โซน B (TENT-B04)',
			subtitle: 'ความจุ 10/12 เตียง • ผู้ดูแล: พว. กรรณิการ์',
			group: 'records',
			icon: Bed,
			action: () => {
				toast.info('เปิดข้อมูลเต็นท์ TENT-B04');
				open = false;
			}
		}
	];

	const filteredItems = $derived(
		items.filter((item) => {
			if (!searchQuery.trim()) return true;
			const query = searchQuery.toLowerCase().trim();
			return (
				item.title.toLowerCase().includes(query) ||
				(item.subtitle && item.subtitle.toLowerCase().includes(query)) ||
				(item.shortcut && item.shortcut.toLowerCase().includes(query))
			);
		})
	);

	const groupedItems = $derived({
		actions: filteredItems.filter((i) => i.group === 'actions'),
		navigation: filteredItems.filter((i) => i.group === 'navigation'),
		records: filteredItems.filter((i) => i.group === 'records')
	});

	function handleKeyDown(e: KeyboardEvent) {
		// Global Shortcut: ⌘K or Ctrl+K
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			open = !open;
			if (open) {
				searchQuery = '';
				selectedIndex = 0;
			}
			return;
		}

		// If palette is closed, skip navigation handling
		if (!open) return;

		if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (filteredItems.length > 0) {
				selectedIndex = (selectedIndex + 1) % filteredItems.length;
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (filteredItems.length > 0) {
				selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (filteredItems[selectedIndex]) {
				const item = filteredItems[selectedIndex];
				item.action();
				if (onselect) onselect(item);
			}
		}
	}

	function handleItemClick(item: CommandItemType) {
		item.action();
		if (onselect) onselect(item);
	}
	function focusInput(node: HTMLElement) {
		node.focus();
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if open}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex animate-in items-start justify-center bg-slate-900/40 p-4 backdrop-blur-xs duration-150 fade-in sm:p-6 md:p-20"
		onclick={(e) => {
			if (e.target === e.currentTarget) open = false;
		}}
	>
		<!-- Command Palette Container -->
		<div
			class="flex max-h-[85vh] w-full max-w-2xl animate-in flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl duration-150 zoom-in-95"
		>
			<!-- Search Bar Header -->
			<div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3.5">
				<Search class="h-5 w-5 shrink-0 text-slate-400" />
				<input
					type="text"
					use:focusInput
					bind:value={searchQuery}
					placeholder="ค้นหาชื่อผู้พักพิง, เต็นท์, หน้าจอ, หรือคำสั่งด่วน..."
					class="w-full bg-transparent text-base text-slate-800 placeholder:text-slate-400 focus:outline-hidden"
				/>
				{#if searchQuery}
					<button
						type="button"
						onclick={() => (searchQuery = '')}
						class="rounded-md p-1 text-slate-400 transition-colors hover:text-slate-600"
					>
						<X class="h-4 w-4" />
					</button>
				{/if}
				<kbd
					class="hidden shrink-0 items-center justify-center rounded-md border border-slate-300/80 bg-slate-200/80 px-2 py-0.5 font-mono text-xs font-semibold text-slate-500 shadow-2xs sm:inline-flex"
				>
					ESC
				</kbd>
			</div>

			<!-- Search Results List -->
			<div class="max-h-[60vh] space-y-4 overflow-y-auto p-2">
				{#if filteredItems.length === 0}
					<div class="py-12 text-center">
						<Search class="mx-auto mb-2 h-10 w-10 stroke-[1.5] text-slate-300" />
						<p class="text-sm font-semibold text-slate-700">ไม่พบข้อมูลที่ตรงกับคำค้นหา</p>
						<p class="mt-0.5 text-xs text-slate-500">
							ลองค้นหาด้วยคำอื่น เช่น "สมชาย", "ลงทะเบียน", หรือ "เต็นท์"
						</p>
					</div>
				{:else}
					<!-- Group: Quick Actions -->
					{#if groupedItems.actions.length > 0}
						<div>
							<div
								class="px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-slate-600 uppercase"
							>
								คำสั่งด่วน (Quick Actions)
							</div>
							<div class="mt-1 space-y-1">
								{#each groupedItems.actions as item (item.id)}
									{@const globalIdx = filteredItems.indexOf(item)}
									{@const isSelected = selectedIndex === globalIdx}
									<button
										type="button"
										onclick={() => handleItemClick(item)}
										onmouseenter={() => (selectedIndex = globalIdx)}
										class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all {isSelected
											? 'bg-slate-100 text-slate-900 ring-1 ring-slate-200/80'
											: 'text-slate-700 hover:bg-slate-50'}"
									>
										<div class="flex min-w-0 items-center gap-3">
											<div
												class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {isSelected
													? 'bg-navy-900 text-white'
													: 'bg-slate-100 text-slate-600'}"
											>
												<item.icon class="h-4 w-4" />
											</div>
											<div class="truncate">
												<div class="truncate text-sm font-semibold">{item.title}</div>
												{#if item.subtitle}
													<div class="truncate text-xs text-slate-500">{item.subtitle}</div>
												{/if}
											</div>
										</div>
										{#if item.shortcut}
											<kbd
												class="ml-2 hidden shrink-0 items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-500 shadow-2xs sm:inline-flex"
											>
												{item.shortcut}
											</kbd>
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Group: Navigation -->
					{#if groupedItems.navigation.length > 0}
						<div>
							<div
								class="px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-slate-600 uppercase"
							>
								การนำทางด่วน (Navigation)
							</div>
							<div class="mt-1 space-y-1">
								{#each groupedItems.navigation as item (item.id)}
									{@const globalIdx = filteredItems.indexOf(item)}
									{@const isSelected = selectedIndex === globalIdx}
									<button
										type="button"
										onclick={() => handleItemClick(item)}
										onmouseenter={() => (selectedIndex = globalIdx)}
										class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all {isSelected
											? 'bg-slate-100 text-slate-900 ring-1 ring-slate-200/80'
											: 'text-slate-700 hover:bg-slate-50'}"
									>
										<div class="flex min-w-0 items-center gap-3">
											<div
												class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {isSelected
													? 'bg-navy-900 text-white'
													: 'bg-slate-100 text-slate-600'}"
											>
												<item.icon class="h-4 w-4" />
											</div>
											<div class="truncate">
												<div class="truncate text-sm font-semibold">{item.title}</div>
												{#if item.subtitle}
													<div class="truncate text-xs text-slate-500">{item.subtitle}</div>
												{/if}
											</div>
										</div>
										<ArrowRight class="ml-2 h-4 w-4 shrink-0 text-slate-400" />
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Group: Records -->
					{#if groupedItems.records.length > 0}
						<div>
							<div
								class="px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-slate-600 uppercase"
							>
								ข้อมูลผู้พักพิงและเต็นท์ (Records)
							</div>
							<div class="mt-1 space-y-1">
								{#each groupedItems.records as item (item.id)}
									{@const globalIdx = filteredItems.indexOf(item)}
									{@const isSelected = selectedIndex === globalIdx}
									<button
										type="button"
										onclick={() => handleItemClick(item)}
										onmouseenter={() => (selectedIndex = globalIdx)}
										class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all {isSelected
											? 'bg-slate-100 text-slate-900 ring-1 ring-slate-200/80'
											: 'text-slate-700 hover:bg-slate-50'}"
									>
										<div class="flex min-w-0 items-center gap-3">
											<div
												class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {isSelected
													? 'bg-navy-900 text-white'
													: 'bg-slate-100 text-slate-600'}"
											>
												<item.icon class="h-4 w-4" />
											</div>
											<div class="truncate">
												<div class="truncate text-sm font-semibold">{item.title}</div>
												{#if item.subtitle}
													<div class="truncate text-xs text-slate-500">{item.subtitle}</div>
												{/if}
											</div>
										</div>
										<span class="ml-2 shrink-0 text-xs font-medium text-slate-400">เปิดดู</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Footer Help Hints -->
			<div
				class="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500"
			>
				<div class="flex items-center gap-4">
					<span class="inline-flex items-center gap-1.5">
						<kbd
							class="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs shadow-2xs"
							>↑</kbd
						>
						<kbd
							class="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs shadow-2xs"
							>↓</kbd
						>
						เลือกรายการ
					</span>
					<span class="inline-flex items-center gap-1.5">
						<kbd
							class="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs shadow-2xs"
							>↵</kbd
						>
						ยืนยัน
					</span>
				</div>
				<span class="text-xs text-slate-600">SmartShelter Civic Palette</span>
			</div>
		</div>
	</div>
{/if}
