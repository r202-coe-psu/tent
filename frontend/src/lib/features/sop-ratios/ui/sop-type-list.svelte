<script lang="ts">
	export type SopTabType = 'sphere_standard' | 'alert_threshold';

	let {
		activeTab = $bindable(),
		sphereCount = 20,
		alertCount = 8
	}: {
		activeTab: SopTabType;
		sphereCount?: number;
		alertCount?: number;
	} = $props();

	const tabs = $derived([
		{
			key: 'sphere_standard' as const,
			label: 'ตัวคูณมาตรฐานดำรงชีพ (Sphere Standard)',
			count: sphereCount
		},
		{
			key: 'alert_threshold' as const,
			label: 'เกณฑ์การแจ้งเตือน (Alert Threshold)',
			count: alertCount
		}
	]);
</script>

<aside class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
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
				<div class="flex-1">
					<div class="text-sm leading-tight font-semibold">{tab.label}</div>
					<div
						class="mt-1 text-xs {isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}"
					>
						{isActive ? 'กำลังแสดงข้อมูล' : 'คลิกเพื่อเลือก'}
					</div>
				</div>
				<span
					class="flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold
						{isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-foreground'}"
				>
					{tab.count}
				</span>
			</button>
		{/each}
	</nav>
</aside>
