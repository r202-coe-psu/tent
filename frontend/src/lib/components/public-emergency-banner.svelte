<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Info from '@lucide/svelte/icons/info';
	import type { Announcement } from '$lib/features/announcements';

	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_EMERGENCY_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let {
		announcement,
		alerts = []
	}: {
		announcement: Partial<Announcement>;
		alerts?: { name: string; capacity: string; variant: string }[];
	} = $props();

	let isDanger = $derived(announcement?.severity === 'emergency');
	let isWarning = $derived(announcement?.severity === 'warning');

	let bannerClass = $derived(
		isDanger
			? 'border-danger-border bg-danger-muted/30'
			: isWarning
				? 'border-warning/30 bg-warning/10'
				: 'border-primary-muted bg-primary-muted/10'
	);

	let borderClass = $derived(
		isDanger ? 'border-danger' : isWarning ? 'border-warning' : 'border-primary'
	);
	let iconBgClass = $derived(
		isDanger
			? 'bg-danger-muted text-danger'
			: isWarning
				? 'bg-warning/20 text-warning'
				: 'bg-primary/20 text-primary'
	);
	let titleClass = $derived(
		isDanger ? 'text-danger' : isWarning ? 'text-warning-foreground' : 'text-primary'
	);
	let descClass = $derived(
		isDanger ? 'text-danger-subtle' : isWarning ? 'text-muted-foreground' : 'text-muted-foreground'
	);

	let badgeColor = $derived(
		isDanger
			? 'bg-red-50 text-red-700 border-red-200'
			: isWarning
				? 'bg-amber-50 text-amber-700 border-amber-200'
				: 'bg-blue-50 text-blue-700 border-blue-200'
	);

	let t = $derived(getTranslation(PUBLIC_EMERGENCY_I18N, langState.current));
	let badgeLabel = $derived(isDanger ? t.emergency : isWarning ? t.warning : t.info);

	let isEnglish = $derived(langState.current === 'en');
	let displayTitle = $derived(
		isEnglish && announcement?.title_en ? announcement.title_en : announcement?.title || t.urgent
	);
	let displayDesc = $derived(
		isEnglish && announcement?.description_en
			? announcement.description_en
			: announcement?.description || ''
	);
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
					class="inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold shadow-sm md:text-xs {badgeColor}"
				>
					<span class="hidden md:inline">{badgeLabel}</span>
					<span class="md:hidden">{badgeLabel.split(' ')[0]}</span>
				</span>
				<h3 class="text-base font-bold {titleClass}">
					{displayTitle}
				</h3>
			</div>
			<p class="h-full text-sm leading-relaxed break-words {descClass}">
				{displayDesc}
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
								class="rounded-md px-2 py-0.5 text-2xs font-bold uppercase
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
