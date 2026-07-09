<script lang="ts">
	import type { SopMaster, SopOverride } from '../index.js';
	import SopMasterView from './sop-master-view.svelte';
	import SopOverrideView from './sop-override-view.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let {
		profile,
		activeContext = $bindable('master'),
		hasOverride,
		isSA,
		canEditOverride,
		shelterCode,
		disabled,
		onEditAll,
		onCreateOverride,
		onDeactivateOverride,
		onViewHistory
	}: {
		profile: SopMaster | SopOverride | null;
		activeContext: 'master' | 'override';
		hasOverride: boolean;
		isSA: boolean;
		canEditOverride: boolean;
		shelterCode: string;
		disabled: boolean;
		onEditAll: () => void;
		onCreateOverride: () => void;
		onDeactivateOverride: () => void;
		onViewHistory: () => void;
	} = $props();

	let search = $state('');
</script>

<section
	class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6"
	aria-label="รายการข้อมูล"
>
	<header class="mb-6 flex flex-col gap-4">
		<!-- Row 1: Title + Search -->
		<div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
			<h1 class="text-xl font-semibold">
				{activeContext === 'master' ? 'EOC มาตรฐาน' : 'ค่าปรับแต่งเฉพาะศูนย์'}
			</h1>

			<div class="relative w-full sm:w-64">
				<Input
					bind:value={search}
					type="search"
					placeholder="ค้นหา..."
					class="pl-9"
					aria-label="ค้นหา"
				/>
				<svg
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.3-4.3" />
				</svg>
			</div>
		</div>

		<!-- Row 2: Tab Selector + Right Actions -->
		<div
			class="flex w-full flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div class="flex w-fit shrink-0 rounded-md border bg-background p-0.5 text-xs">
				<button
					type="button"
					class="rounded-sm px-3 py-1 transition {activeContext === 'master'
						? 'bg-primary font-semibold text-primary-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => {
						activeContext = 'master';
					}}
				>
					EOC มาตรฐาน
				</button>
				<button
					type="button"
					class="rounded-sm px-3 py-1 transition {activeContext === 'override'
						? 'bg-amber-500 font-semibold text-white shadow-sm'
						: 'text-muted-foreground hover:text-foreground'} disabled:opacity-50"
					onclick={() => {
						activeContext = 'override';
					}}
					disabled={!shelterCode}
					title={shelterCode ? 'แสดงค่าปรับแต่งเฉพาะศูนย์' : 'กรุณาเลือกศูนย์พักพิงเพื่อเปิดใช้งาน'}
				>
					ปรับแต่งเฉพาะศูนย์
				</button>
			</div>

			<!-- Right aligned Actions (Audit/Cancel Override/Edit All) -->
			<div class="flex w-full items-center justify-end gap-2 sm:ml-auto sm:w-auto">
				{#if activeContext === 'override' && profile && canEditOverride && hasOverride}
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="h-8 border-red-200 text-red-700 hover:bg-red-50"
						{disabled}
						onclick={onDeactivateOverride}
					>
						ยกเลิกค่าปรับแต่ง
					</Button>
				{/if}
				{#if profile}
					{#if (activeContext === 'master' && isSA) || (activeContext === 'override' && canEditOverride && hasOverride)}
						<Button
							type="button"
							size="sm"
							onclick={onEditAll}
							{disabled}
							class="h-8 bg-[#013365] font-semibold text-white shadow-sm hover:bg-[#002244]"
						>
							✏ แก้ไขพารามิเตอร์
						</Button>
					{/if}
					<Button type="button" variant="outline" size="sm" onclick={onViewHistory} class="h-8">
						ประวัติ ({profile.version})
					</Button>
				{/if}
			</div>
		</div>
	</header>

	{#if activeContext === 'master'}
		<SopMasterView profile={profile as SopMaster | null} {search} />
	{:else}
		<SopOverrideView
			profile={profile as SopOverride | null}
			{shelterCode}
			{hasOverride}
			{disabled}
			{canEditOverride}
			{onCreateOverride}
			{search}
		/>
	{/if}
</section>
