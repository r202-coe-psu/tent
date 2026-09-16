<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { getCountryName } from '$lib/utils/country';
	import { AGE_BUCKETS, AGE_BUCKET_LABELS, emptyAgeGroups } from '$lib/features/dashboard';
	import type { OverviewDemographicsPayload } from '../domain/schemas';

	let {
		age_groups,
		countries,
		age_by_country,
		loading = false
	}: {
		age_groups: OverviewDemographicsPayload['age_groups'] | undefined;
		countries: OverviewDemographicsPayload['countries'] | undefined;
		age_by_country: OverviewDemographicsPayload['age_by_country'] | undefined;
		loading?: boolean;
	} = $props();

	let selectedCountry = $state<string | null>(null);

	function countryLabel(code: string): string {
		return code === 'UNKNOWN' ? 'ไม่ระบุ' : getCountryName(code);
	}

	function toggleCountry(code: string) {
		selectedCountry = selectedCountry === code ? null : code;
	}

	const displayedAgeGroups = $derived(
		selectedCountry
			? (age_by_country?.[selectedCountry] ?? emptyAgeGroups())
			: age_groups
	);

	const ageRows = $derived(
		AGE_BUCKETS.map((band) => ({
			band,
			label: AGE_BUCKET_LABELS[band],
			count: displayedAgeGroups?.[band] ?? 0
		}))
	);

	const countryRows = $derived.by(() => {
		const sorted = Object.entries(countries ?? {}).sort((a, b) => b[1] - a[1]);
		const top = sorted.slice(0, 8);
		if (selectedCountry && !top.some(([code]) => code === selectedCountry)) {
			const selectedEntry = sorted.find(([code]) => code === selectedCountry);
			if (selectedEntry) top.push(selectedEntry);
		}
		return top.map(([code, count]) => ({
			code,
			label: countryLabel(code),
			count
		}));
	});

	const selectedLabel = $derived(selectedCountry ? countryLabel(selectedCountry) : null);
</script>

<Card.Root class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
	<Card.Header>
		<Card.Title class="text-lg font-bold text-slate-900">ประชากรศาสตร์</Card.Title>
		<Card.Description class="text-sm text-slate-500">
			ช่วงอายุและสัญชาติ (Top) — กดประเทศเพื่อจำแนกช่วงอายุตามสัญชาติ
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if loading && !age_groups}
			<Skeleton class="h-40 w-full rounded-xl" />
		{:else}
			<div class="grid gap-6 md:grid-cols-2">
				<div class="space-y-3">
					<div class="flex items-center justify-between gap-2">
						<h3 class="text-sm font-semibold text-slate-800">
							{#if selectedLabel}
								ช่วงอายุ · {selectedLabel}
							{:else}
								ช่วงอายุ
							{/if}
						</h3>
						{#if selectedCountry}
							<button
								type="button"
								class="text-xs font-medium text-sky-700 hover:text-sky-900 hover:underline"
								onclick={() => (selectedCountry = null)}
							>
								ทั้งหมด
							</button>
						{/if}
					</div>
					<ul class="space-y-2">
						{#each ageRows as row (row.band)}
							<li class="flex items-center justify-between gap-3 text-sm">
								<span class="text-slate-700">{row.label}</span>
								<span class="font-semibold text-slate-900 tabular-nums">{row.count}</span>
							</li>
						{/each}
					</ul>
				</div>
				<div class="space-y-3">
					<h3 class="text-sm font-semibold text-slate-800">ประเทศ (สูงสุด)</h3>
					{#if countryRows.length === 0}
						<p class="text-sm text-slate-500">ไม่มีข้อมูลสัญชาติ</p>
					{:else}
						<ul class="space-y-2">
							{#each countryRows as row (row.code)}
								<li>
									<button
										type="button"
										aria-pressed={selectedCountry === row.code}
										class={[
											'flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors',
											selectedCountry === row.code
												? 'border border-sky-200 bg-sky-50 font-semibold text-sky-900'
												: 'border border-transparent text-slate-700 hover:bg-slate-50'
										]}
										onclick={() => toggleCountry(row.code)}
									>
										<span>{row.label}</span>
										<span
											class={[
												'tabular-nums',
												selectedCountry === row.code
													? 'font-semibold text-sky-900'
													: 'font-semibold text-slate-900'
											]}
										>
											{row.count}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
