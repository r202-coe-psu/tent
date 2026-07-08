<script lang="ts">
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { DonationCampaign } from '$lib/features/operations';

	export interface NeedItem {
		id: string;
		title: string;
		location: string;
		showOnHome: boolean;
		isCutOff: boolean;
		isManualClosed: boolean;
		needs: {
			itemId: string;
			name: string;
			reserved: number;
			onHand: number;
			target: number;
			unit: string;
			isCutOff: boolean;
			isManualClosed: boolean;
		}[];
		campaignDoc: DonationCampaign;
	}

	let {
		items = [],
		onAddRequest,
		onToggleShowOnHome,
		onToggleCutOff
	}: {
		items: NeedItem[];
		onAddRequest: () => void;
		onToggleShowOnHome: (id: string) => void;
		onToggleCutOff: (id: string, itemId: string) => void;
	} = $props();

	let searchQuery = $state('');

	let filteredItems = $derived(
		items.filter(
			(item) =>
				item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
				item.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
				item.needs.some((need) => need.name.toLowerCase().includes(searchQuery.toLowerCase()))
		)
	);
</script>

<div class="relative mb-4 w-full md:w-80">
	<Input
		type="text"
		placeholder="ค้นหารายการพัสดุ..."
		bind:value={searchQuery}
		class="w-full rounded-xl border border-border bg-card px-3 py-2 pl-9 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
	/>
	<Search class="absolute top-2.5 left-3 h-3.5 w-3.5 text-muted-foreground" />
</div>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<div
		class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 md:flex-row md:items-center"
	>
		<div>
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<Megaphone class="h-4 w-4 text-primary" />
				จัดการกระดานแจ้งความต้องการด่วน (Public Needs Board)
			</h2>
			<p class="mt-1 text-[11px] text-muted-foreground">
				สับสวิตช์เปิด-ปิด
				หรือจำกัดจำนวนรายการสิ่งของที่ศูนย์ต้องการแจ้งให้สาธารณชนรับทราบผ่านทางหน้าเว็บแรก
			</p>
		</div>
		<div>
			<Button
				onclick={onAddRequest}
				class="flex cursor-pointer items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-xs font-bold text-background shadow-xs transition-colors hover:bg-foreground/90"
			>
				<Plus class="h-3.5 w-3.5" />
				สร้างประกาศแบบกำหนดเอง (Special Request)
			</Button>
		</div>
	</div>

	<div class="overflow-x-auto">
		<Table.Root class="w-full border-collapse text-left">
			<Table.Header>
				<Table.Row
					class="border-b border-border bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase"
				>
					<Table.Head class="px-6 py-4">แคมเปญ / ประกาศพิเศษ</Table.Head>
					<Table.Head class="px-6 py-4">รายการความต้องการและความคืบหน้า</Table.Head>
					<Table.Head class="px-6 py-4 text-center">สถานะโปรโมตหน้าแรก</Table.Head>
					<Table.Head class="px-6 py-4 text-center">การจัดการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body class="divide-y divide-border/60 text-xs">
				{#each filteredItems as item (item.id)}
					<Table.Row
						class="transition-colors hover:bg-muted/5 {item.isCutOff
							? 'bg-muted/10 opacity-65'
							: ''}"
					>
						<Table.Cell class="px-6 py-4 align-top">
							<div class="flex items-center gap-2 font-bold text-foreground">
								{#if item.isCutOff}
									<span
										class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-extrabold text-red-600 dark:bg-red-950/50 dark:text-red-400"
										>CUT-OFF</span
									>
								{/if}
								{item.title}
							</div>
							<div class="mt-1 text-[10px] text-muted-foreground">{item.location}</div>
						</Table.Cell>

						<Table.Cell class="px-6 py-4">
							<div class="flex flex-col gap-4">
								{#each item.needs as need (need.itemId)}
									{@const totalAcquired = need.reserved + need.onHand}
									{@const progressPercent = Math.min(
										Math.round((totalAcquired / need.target) * 100),
										100
									)}
									<div class="flex flex-col gap-1">
										<div
											class="flex items-center justify-between text-[11px] font-medium text-foreground"
										>
											<div class="flex items-center gap-1.5">
												<span>{need.name}</span>
												{#if need.isCutOff}
													<span
														class="py-0.2 rounded bg-amber-100 px-1 text-[8px] font-extrabold text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
													>
														FULL
													</span>
												{/if}
											</div>
											<span class="text-muted-foreground">
												จอง: {need.reserved} · คลัง: {need.onHand} / เป้าหมาย: {need.target}
												{need.unit} ({progressPercent}%)
											</span>
										</div>
										<div
											class="relative h-2 w-full overflow-hidden rounded-full border border-border/40 bg-muted"
										>
											<div
												class="h-full rounded-full transition-all duration-300 {need.isCutOff
													? 'bg-red-500'
													: 'bg-primary'}"
												style="width: {progressPercent}%"
											></div>
										</div>
									</div>
								{/each}
							</div>
						</Table.Cell>

						<Table.Cell class="px-6 py-4 text-center align-top">
							<button
								type="button"
								onclick={() => onToggleShowOnHome(item.id)}
								disabled={item.isCutOff}
								class="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all
								{item.showOnHome && !item.isCutOff
									? 'border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-400'
									: 'cursor-not-allowed border-transparent bg-muted text-muted-foreground opacity-50'}"
							>
								{item.showOnHome && !item.isCutOff ? 'กำลังโชว์บนหน้าเว็บ' : 'ซ่อนจากหน้าเว็บ'}
							</button>
						</Table.Cell>

						<Table.Cell class="px-6 py-4 align-top">
							<div class="flex flex-col gap-4">
								{#each item.needs as need (need.itemId)}
									<div class="flex h-[34px] items-center justify-center">
										{#if need.isCutOff && !need.isManualClosed}
											<button
												type="button"
												disabled
												class="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-muted bg-muted/50 px-3 py-1.5 text-[11px] font-bold text-muted-foreground opacity-70"
											>
												ปิดอัตโนมัติ (ครบเป้า)
											</button>
										{:else}
											<button
												type="button"
												onclick={() => onToggleCutOff(item.id, need.itemId)}
												class="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors
												{need.isManualClosed
													? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100/70 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400'
													: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100/70 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400'}"
											>
												{need.isManualClosed
													? 'เปิดรับบริจาค (Restore)'
													: 'Force Cut-off (ปิดด่วน)'}
											</button>
										{/if}
									</div>
								{/each}
							</div>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={4} class="px-6 py-8 text-center text-muted-foreground">
							ไม่พบรายการความต้องการที่ค้นหา
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
