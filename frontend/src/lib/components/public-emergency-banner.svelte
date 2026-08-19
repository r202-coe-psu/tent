<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Info from '@lucide/svelte/icons/info';
	import type { Announcement } from '$lib/features/announcements';

	export let announcement: Partial<Announcement>;
	export let alerts: { name: string; capacity: string; variant: string }[] = [];

	$: isDanger = announcement?.severity === 'emergency';
	$: isWarning = announcement?.severity === 'warning';

	$: bannerClass = isDanger
		? 'border-danger-border bg-danger-muted/30'
		: isWarning
			? 'border-warning/30 bg-warning/10'
			: 'border-primary-muted bg-primary-muted/10';

	$: borderClass = isDanger ? 'border-danger' : isWarning ? 'border-warning' : 'border-primary';
	$: iconBgClass = isDanger
		? 'bg-danger-muted text-danger'
		: isWarning
			? 'bg-warning/20 text-warning'
			: 'bg-primary/20 text-primary';
	$: titleClass = isDanger ? 'text-danger' : isWarning ? 'text-warning-foreground' : 'text-primary';
	$: descClass = isDanger
		? 'text-danger-subtle'
		: isWarning
			? 'text-muted-foreground'
			: 'text-muted-foreground';

	$: badgeColor = isDanger
		? 'bg-red-50 text-red-700 border-red-200'
		: isWarning
			? 'bg-amber-50 text-amber-700 border-amber-200'
			: 'bg-blue-50 text-blue-700 border-blue-200';

	$: badgeLabel = isDanger
		? 'ฉุกเฉิน (Emergency)'
		: isWarning
			? 'แจ้งเตือน (Warning)'
			: 'ทั่วไป (Info)';
</script>

<div
	class="mb-8 overflow-hidden rounded-xl border shadow-xs backdrop-blur-md md:relative md:z-auto {bannerClass}"
>
	<div class="flex flex-col border-l-4 p-5 md:flex-row md:items-start md:gap-4 {borderClass}">
		<!-- Alert Icon -->
		<div
			class="mb-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg md:mb-0 {iconBgClass}"
		>
			{#if isDanger}
				<ShieldAlert class="h-6 w-6" />
			{:else if isWarning}
				<AlertCircle class="h-6 w-6" />
			{:else}
				<Info class="h-6 w-6" />
			{/if}
		</div>
		<!-- Alert Content -->
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<div class="flex items-center gap-2">
				<span
					class="inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm md:text-xs {badgeColor}"
				>
					<span class="hidden md:inline">{badgeLabel}</span>
					<span class="md:hidden">{badgeLabel.split(' ')[0]}</span>
				</span>
				<h3 class="text-base font-bold {titleClass}">{announcement?.title || 'ประกาศด่วน'}</h3>
			</div>
			<p class="h-full text-sm leading-relaxed break-words {descClass}">
				{announcement?.description || ''}
			</p>
			<!-- Shelter Badges (optional) -->
			{#if alerts.length > 0}
				<div class="mt-4 flex flex-wrap gap-3">
					{#each alerts as alert (alert.name)}
						<div
							class="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 shadow-2xs"
						>
							<span class="text-xs font-semibold text-card-foreground">{alert.name}</span>
							<span
								class="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase
								{alert.variant === 'danger' ? 'bg-danger-muted text-danger' : 'bg-chart-2/15 text-chart-2'}"
							>
								{alert.capacity}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
