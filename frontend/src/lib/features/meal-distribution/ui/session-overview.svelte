<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import Sun from '@lucide/svelte/icons/sun';
	import Utensils from '@lucide/svelte/icons/utensils';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import History from '@lucide/svelte/icons/history';
	import { MEAL_PERIOD_LABELS } from '$lib/features/kitchen';
	import {
		MEAL_PERIOD_EN_LABELS,
		MEAL_FILTER_TAGS,
		mealDateShortLabel,
		quotaPercent,
		sessionServedTotal,
		todayIsoDate
	} from '../domain/meal-distribution';
	import { getMealsStore } from '../application/meal-distribution-store.svelte';

	const store = getMealsStore();
	const todayLabel = mealDateShortLabel(todayIsoDate());
</script>

<div class="space-y-6">
	<!-- Session selector -->
	<div class="flex flex-col justify-between gap-3 md:flex-row md:items-center">
		<h3 class="flex items-center gap-1.5 text-sm font-bold tracking-wider text-slate-500">
			<span>เลือกรอบมื้ออาหารประจำวัน (DAILY MEAL SESSIONS)</span>
			<Badge variant="outline" class="border-none bg-slate-100 text-xs font-bold text-slate-500">
				{store.visibleSessions.length} รอบมื้อ
			</Badge>
		</h3>

		<div class="flex overflow-hidden rounded-lg border border-slate-200">
			<Button
				size="sm"
				variant={store.dateFilterMode === 'day' ? 'default' : 'ghost'}
				onclick={() => store.setDateFilterMode('day')}
				class="gap-1.5 rounded-none text-xs font-bold
					{store.dateFilterMode === 'day' ? 'bg-[#0A2647] text-white hover:bg-[#0A2647]/90' : ''}"
			>
				<CalendarDays class="size-3.5" />
				<span>วันนี้ ({todayLabel})</span>
			</Button>
			<Button
				size="sm"
				variant={store.dateFilterMode === 'all' ? 'default' : 'ghost'}
				onclick={() => store.setDateFilterMode('all')}
				class="rounded-none text-xs font-bold
					{store.dateFilterMode === 'all' ? 'bg-[#0A2647] text-white hover:bg-[#0A2647]/90' : ''}"
			>
				ทั้งหมด
			</Button>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
		{#each store.visibleSessions as session (session.id)}
			{@const served = sessionServedTotal(session)}
			<button
				onclick={() => store.selectSession(session.id)}
				class="group relative flex min-h-[160px] flex-col justify-between overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition-all duration-200
					{store.selectedSessionId === session.id
					? 'border-transparent bg-[#0A2647] text-white shadow-md ring-2 ring-[#0A2647]/20'
					: 'border-slate-200 bg-white hover:border-slate-300'}"
			>
				<div class="flex w-full items-start justify-between">
					<div class="flex items-center gap-2">
						<div
							class="flex size-8 items-center justify-center rounded-lg
								{store.selectedSessionId === session.id ? 'bg-amber-500 text-white' : 'bg-slate-100'}"
						>
							{#if session.id === 'breakfast'}
								<Sun class="size-4.5" />
							{:else}
								<Utensils class="size-4.5" />
							{/if}
						</div>
						<div>
							<h4
								class="text-sm font-bold {store.selectedSessionId === session.id
									? 'text-white'
									: 'text-slate-900'}"
							>
								{MEAL_PERIOD_LABELS[session.id]}
								<span class="text-xs font-normal opacity-60"
									>({MEAL_PERIOD_EN_LABELS[session.id]})</span
								>
							</h4>
							<p class="text-xs opacity-75">{session.timeRange}</p>
						</div>
					</div>

					<Badge
						variant="outline"
						class="border-none text-xs font-bold
							{session.status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}"
					>
						{session.status === 'open' ? 'เปิดแจกอยู่' : 'ปิดรอบแล้ว'}
					</Badge>
				</div>

				<div class="mt-4 w-full space-y-1.5">
					<div class="flex items-center gap-1 text-xs opacity-75">
						<UtensilsCrossed class="size-3" />
						<span>{session.menus.length} เมนูพร้อมบริการ</span>
					</div>
					<div class="flex items-baseline justify-between text-xs font-bold">
						<span class="text-xs opacity-60">แจกจ่ายแล้ว</span>
						<span class="text-base font-black">
							{served}
							<span class="text-xs font-normal opacity-60">/ {session.targetTotal} ที่</span>
						</span>
					</div>
					<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
						<div
							class="h-full rounded-full bg-amber-500 transition-all duration-300"
							style:width="{quotaPercent(served, session.targetTotal)}%"
						></div>
					</div>
				</div>
			</button>
		{/each}
	</div>

	<!-- Menus in the selected session -->
	<div class="space-y-4 border-t border-slate-200 pt-2">
		<div class="flex flex-col justify-between gap-3 md:flex-row md:items-center">
			<div class="flex items-center gap-2">
				<UtensilsCrossed class="size-4 text-slate-700" />
				<div>
					<h3 class="text-base font-extrabold text-slate-900">
						เมนูอาหารในรอบ:
						<span class="underline decoration-amber-500 decoration-2"
							>{MEAL_PERIOD_LABELS[store.selectedSession.id]} ({MEAL_PERIOD_EN_LABELS[
								store.selectedSession.id
							]})</span
						>
					</h3>
					<p class="text-xs text-slate-500">
						เลือกเมนูที่ต้องการเพื่อเปิดจุดแจกจ่าย POS ประจำจุดบริการ (Stage 2: Kiosk)
					</p>
				</div>
			</div>

			<div class="flex flex-wrap gap-1.5">
				{#each MEAL_FILTER_TAGS as tag (tag)}
					<Button
						size="sm"
						variant={store.activeFilterTag === tag ? 'default' : 'outline'}
						onclick={() => store.setFilterTag(tag)}
						class="rounded-full text-xs font-bold
							{store.activeFilterTag === tag ? 'bg-[#0A2647] text-white hover:bg-[#0A2647]/90' : ''}"
					>
						{tag === 'ทั้งหมด' ? '+ ทั้งหมด' : tag}
					</Button>
				{/each}
			</div>
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each store.filteredMenus as menu (menu.id)}
				<div
					class="flex min-h-[260px] flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
				>
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<div class="flex flex-wrap gap-1">
								{#each menu.tags as tag (tag)}
									<Badge
										variant="outline"
										class="border-none text-xs font-bold
											{tag === 'Everyone' || tag === 'ปกติ' ? 'bg-blue-50 text-blue-700' : ''}
											{tag === 'Halal' || tag === 'อิสลาม' ? 'bg-emerald-50 text-emerald-700' : ''}
											{tag === 'กลุ่มเปราะบาง' || tag === 'ผู้สูงอายุ' || tag === 'เด็กเล็ก'
											? 'bg-purple-50 text-purple-700'
											: ''}
											{tag === 'มังสวิรัติ' || tag === 'เจ' ? 'bg-amber-50 text-amber-700' : ''}"
									>
										{tag}
									</Badge>
								{/each}
							</div>

							<span class="inline-flex items-center gap-1 text-xs font-bold">
								<span
									class="size-1.5 rounded-full {menu.status === 'ready'
										? 'bg-emerald-500'
										: 'bg-red-500'}"
								></span>
								<span class={menu.status === 'ready' ? 'text-emerald-700' : 'text-rose-700'}>
									{menu.status === 'ready' ? 'พร้อมแจกจ่าย' : 'ปิดรอบแล้ว'}
								</span>
							</span>
						</div>

						<div class="space-y-1">
							<h4 class="text-base leading-snug font-extrabold text-slate-900">
								{menu.title}
							</h4>
							<p class="text-xs text-slate-400">
								รหัสแบทช์: {menu.batchCode} • ปรุงเสร็จ: {menu.cookTime}
							</p>
						</div>

						<div class="space-y-1.5 pt-2">
							<div class="flex items-baseline justify-between text-xs">
								<span class="text-xs font-bold tracking-wider text-slate-400 uppercase"
									>ความคืบหน้าโควตา</span
								>
								<span class="text-sm font-black text-slate-900">
									{menu.served}
									<span class="text-xs font-normal text-slate-400">/ {menu.target} ที่</span>
								</span>
							</div>
							<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
								<div
									class="h-full rounded-full bg-amber-500 transition-all duration-300"
									style:width="{quotaPercent(menu.served, menu.target)}%"
								></div>
							</div>
							<div class="flex justify-between text-xs font-bold text-slate-400">
								<span>คงเหลือ: {Math.max(0, menu.target - menu.served)} ที่</span>
								<span>{quotaPercent(menu.served, menu.target)}%</span>
							</div>
						</div>
					</div>

					<div class="mt-2 border-t border-slate-100 pt-4">
						{#if menu.status === 'ready'}
							<Button
								onclick={() => store.startKiosk(menu)}
								class="w-full gap-1.5 rounded-xl bg-[#0A2647] py-2.5 text-xs font-bold text-white shadow-md shadow-slate-900/10 transition-all hover:scale-[1.01] hover:bg-[#051930]"
							>
								<span>เปิดจุดแจกจ่ายเมนูนี้ (Start Kiosk)</span>
								<ArrowRight class="size-3.5" />
							</Button>
						{:else}
							<Button
								variant="outline"
								onclick={() => store.openMenuHistory(menu)}
								class="w-full gap-2 rounded-xl border-amber-200 bg-amber-50/50 py-2.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
							>
								<History class="size-4 text-amber-600" />
								<span>ดูประวัติการแจก (ปิดรอบแล้ว)</span>
							</Button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
