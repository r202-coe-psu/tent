<script lang="ts">
	import type { SopRatioKey, SopMaster, SopOverride } from '../index.js';
	import SopMasterView from './sop-master-view.svelte';
	import SopOverrideView from './sop-override-view.svelte';

	let {
		profile,
		activeContext = $bindable('master'),
		hasOverride,
		isSA,
		canEditOverride,
		shelterCode,
		disabled,
		onEditItem,
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
		onEditItem: (key: SopRatioKey) => void;
		onCreateOverride: () => void;
		onDeactivateOverride: () => void;
		onViewHistory: () => void;
	} = $props();
</script>

<section
	class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6"
	aria-label="รายการข้อมูล"
>
	<header class="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
			<h1 class="text-xl font-semibold">
				{activeContext === 'master' ? 'EOC มาตรฐาน' : 'ค่าปรับแต่งเฉพาะศูนย์'}
			</h1>

			<div class="flex shrink-0 rounded-md border bg-background p-0.5 text-xs">
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
		</div>
	</header>

	{#if activeContext === 'master'}
		<SopMasterView
			profile={profile as SopMaster | null}
			{isSA}
			{disabled}
			{onEditItem}
			{onViewHistory}
		/>
	{:else}
		<SopOverrideView
			profile={profile as SopOverride | null}
			{shelterCode}
			{hasOverride}
			{disabled}
			{canEditOverride}
			{onEditItem}
			{onCreateOverride}
			{onDeactivateOverride}
			{onViewHistory}
		/>
	{/if}
</section>
