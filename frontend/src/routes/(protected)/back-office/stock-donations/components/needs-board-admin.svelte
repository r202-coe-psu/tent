<script lang="ts">
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	interface NeedItem {
		id: string;
		name: string;
		location: string;
		reserved: number;
		target: number;
		showOnHome: boolean;
		isCutOff: boolean;
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
		onToggleCutOff: (id: string) => void;
	} = $props();

	let searchQuery = $state('');

	let filteredItems = $derived(
		items.filter(
			(item) =>
				item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				item.location.toLowerCase().includes(searchQuery.toLowerCase())
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

	<!-- ตารางแสดงรายการ -->
	<div class="overflow-x-auto">
		<Table.Root class="w-full border-collapse text-left">
			<Table.Header>
				<Table.Row
					class="border-b border-border bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase"
				>
					<Table.Head class="px-6 py-4">รายการพัสดุ / ประกาศพิเศษ</Table.Head>
					<Table.Head class="px-6 py-4 text-right">ยอดจองบริจาคแล้ว</Table.Head>
					<Table.Head class="px-6 py-4 text-right">ยอดเป้าหมาย</Table.Head>
					<Table.Head class="px-6 py-4">ความคืบหน้า (PROGRESS)</Table.Head>
					<Table.Head class="px-6 py-4 text-center">สถานะโปรโมตหน้าแรก</Table.Head>
					<Table.Head class="px-6 py-4 text-center">การจัดการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body class="divide-y divide-border/60 text-xs">
				{#each filteredItems as item (item.id)}
					{@const progressPercent = Math.min(Math.round((item.reserved / item.target) * 100), 100)}

					<Table.Row
						class="transition-colors hover:bg-muted/5 {item.isCutOff
							? 'bg-muted/10 opacity-65'
							: ''}"
					>
						<Table.Cell class="px-6 py-4">
							<div class="flex items-center gap-2 font-bold text-foreground">
								{#if item.isCutOff}
									<span
										class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-extrabold text-red-600 dark:bg-red-950/50 dark:text-red-400"
										>CUT-OFF</span
									>
								{/if}
								{item.name}
							</div>
							<div class="mt-0.5 text-[10px] text-muted-foreground">{item.location}</div>
						</Table.Cell>

						<Table.Cell class="px-6 py-4 text-right font-semibold text-foreground">
							<span class="rounded-md border border-border/40 bg-muted px-2.5 py-1">
								{item.reserved.toLocaleString()}
							</span>
						</Table.Cell>

						<Table.Cell class="px-6 py-4 text-right font-semibold text-foreground">
							{item.target.toLocaleString()}
						</Table.Cell>

						<Table.Cell class="min-w-[180px] px-6 py-4">
							<div class="flex items-center gap-3">
								<div
									class="relative h-2 w-28 overflow-hidden rounded-full border border-border/40 bg-muted"
								>
									<div
										class="h-full rounded-full transition-all duration-300 {item.isCutOff
											? 'bg-red-500'
											: 'bg-primary'}"
										style="width: {progressPercent}%"
									></div>
								</div>
								<span class="text-[10px] font-bold text-muted-foreground">{progressPercent}%</span>
							</div>
						</Table.Cell>

						<Table.Cell class="px-6 py-4 text-center">
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

						<Table.Cell class="px-6 py-4 text-center">
							<button
								type="button"
								onclick={() => onToggleCutOff(item.id)}
								class="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors
								{item.isCutOff
									? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100/70 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400'
									: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100/70 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400'}"
							>
								{item.isCutOff ? 'เปิดรับบริจาค (Restore)' : 'Force Cut-off (ปิดด่วน)'}
							</button>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={6} class="px-6 py-8 text-center text-muted-foreground">
							ไม่พบรายการความต้องการที่ค้นหา
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
