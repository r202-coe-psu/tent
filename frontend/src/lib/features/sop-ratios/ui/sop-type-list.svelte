<script lang="ts">
	export type SopTabType =
		| 'sphere_standard'
		| 'food_sphere_standard'
		| 'requirement_group'
		| 'replenishment_policy'
		| 'alert_threshold';

	let {
		activeTab = $bindable(),
		sphereCount = 20,
		alertCount = 8,
		reqGroupCount,
		foodSphereCount,
		replenishmentCount
	}: {
		activeTab: SopTabType;
		sphereCount?: number;
		alertCount?: number;
		reqGroupCount?: number;
		foodSphereCount?: number;
		replenishmentCount?: number;
	} = $props();

	const tabs = $derived<
		{
			key: SopTabType;
			label: string;
			count?: number;
		}[]
	>([
		{
			key: 'sphere_standard' as const,
			label: 'ตัวคูณมาตรฐานดำรงชีพ (Sphere Standard)',
			count: sphereCount
		},
		{
			key: 'alert_threshold' as const,
			label: 'เกณฑ์การแจ้งเตือน (Alert Threshold)',
			count: alertCount
		},
		{
			key: 'requirement_group' as const,
			label: 'กลุ่มสำหรับการคำนวณ',
			count: reqGroupCount
		},
		{
			key: 'food_sphere_standard' as const,
			label: 'พารามิเตอร์อ้างอิงสำหรับอาหาร',
			count: foodSphereCount
		},
		{
			key: 'replenishment_policy' as const,
			label: 'นโยบายการเติมสต็อก',
			count: replenishmentCount
		}
	]);
</script>

<aside class="min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
	<h2 class="mb-3 text-sm font-semibold text-muted-foreground">ประเภทพารามิเตอร์มาสเตอร์</h2>
	<nav class="flex flex-col gap-2">
		{#each tabs as tab (tab.key)}
			{@const isActive = tab.key === activeTab}
			<button
				type="button"
				onclick={() => {
					activeTab = tab.key;
				}}
				aria-current={isActive ? 'page' : undefined}
				class="group flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left transition
					{isActive
					? 'border-transparent bg-primary text-primary-foreground shadow'
					: 'border-input bg-background hover:bg-accent'}"
			>
				<div class="min-w-0 flex-1">
					<div class="truncate text-sm leading-tight font-semibold">{tab.label}</div>
					<div
						class="mt-1 text-xs {isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}"
					>
						{isActive ? 'กำลังแสดงข้อมูล' : 'คลิกเพื่อเลือก'}
					</div>
				</div>
				{#if tab.count !== undefined}
					<span
						class="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold
							{isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-foreground'}"
					>
						{tab.count}
					</span>
				{/if}
			</button>
		{/each}
	</nav>
</aside>
