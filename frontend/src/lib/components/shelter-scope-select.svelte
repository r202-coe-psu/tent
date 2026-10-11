<script lang="ts">
	import { Select, SelectTrigger, SelectContent, SelectItem } from '$lib/components/ui/select';
	import { useShelters } from '$lib/features/shelters';

	type Props = {
		/** Shelters the user may pick from — `null` means every shelter. */
		allowedCodes: string[] | null;
		/** Selected shelter code; `undefined` means "all shelters" (when `includeAll`) or nothing. */
		value?: string | undefined;
		/** Adds a「ทุกศูนย์」option that maps to `undefined`. */
		includeAll?: boolean;
		/** Accessible name for the trigger. */
		ariaLabel?: string;
	};

	let {
		allowedCodes,
		value = $bindable(),
		includeAll = false,
		ariaLabel = 'เลือกศูนย์พักพิง'
	}: Props = $props();

	const ALL = '__all__';
	const ALL_LABEL = 'ทุกศูนย์';

	const sheltersQuery = useShelters();

	const options = $derived(
		(sheltersQuery.data ?? []).filter((s) => allowedCodes === null || allowedCodes.includes(s.code))
	);
	const soleCode = $derived(allowedCodes?.length === 1 ? allowedCodes[0] : null);

	const label = (code: string, name: string) => `${code} — ${name}`;
	const triggerLabel = $derived.by(() => {
		if (value === undefined) return includeAll ? ALL_LABEL : 'เลือกศูนย์พักพิง';
		const shelter = options.find((s) => s.code === value);
		return shelter ? label(shelter.code, shelter.name) : value;
	});
</script>

{#if soleCode}
	{@const sole = options.find((s) => s.code === soleCode)}
	<span class="text-sm font-semibold text-slate-700">
		{sole ? label(sole.code, sole.name) : soleCode}
	</span>
{:else}
	<Select
		type="single"
		bind:value={
			() => value ?? (includeAll ? ALL : ''), (v) => (value = v === ALL || v === '' ? undefined : v)
		}
	>
		<SelectTrigger class="h-11 min-h-11 w-full" aria-label={ariaLabel}>
			<span class="truncate">{triggerLabel}</span>
		</SelectTrigger>
		<SelectContent>
			{#if includeAll}
				<SelectItem value={ALL} label={ALL_LABEL} />
			{/if}
			{#if sheltersQuery.isLoading}
				<SelectItem value="" disabled label="กำลังโหลด..." />
			{:else if options.length === 0}
				<SelectItem value="" disabled label="ไม่มีศูนย์พักพิงที่เข้าถึงได้" />
			{:else}
				{#each options as shelter (shelter.code)}
					<SelectItem value={shelter.code} label={label(shelter.code, shelter.name)} />
				{/each}
			{/if}
		</SelectContent>
	</Select>
{/if}
