<script lang="ts">
	import { fromStore } from 'svelte/store';
	import { Input } from '$lib/components/ui/input/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import type { SuperForm } from 'sveltekit-superforms';
	import { useMasterData } from '$lib/features/master-data';
	import type { HouseholdFormData } from '../domain/people';

	let {
		form,
		mzVal = $bindable(),
		commVal = $bindable(),
		municipalityZoneItems,
		communityItems,
		mzPending,
		commPending
	}: {
		form: SuperForm<HouseholdFormData>;
		mzVal: string;
		commVal: string;
		municipalityZoneItems: { value: string; label: string }[];
		communityItems: { value: string; label: string }[];
		mzPending: boolean;
		commPending: boolean;
	} = $props();

	/** SuperForm `.form` is a store — `fromStore` exposes rune-friendly `.current`. */
	const formData = $derived(fromStore(form.form));

	const housingTypeQuery = useMasterData(() => 'housing_type');
	const housingTypeItems = $derived(
		(housingTypeQuery.data?.items ?? [])
			.filter((i) => i.status === 'active')
			.map((i) => ({ value: i.code, label: i.label }))
	);

	const isHomeless = $derived(formData.current.housing_type === 'homeless');

	const selectTriggerClass =
		"flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4";
</script>

<!-- เขต / ชุมชน -->
<div class="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
	<h3
		class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
	>
		<MapPin class="size-3.5" />
		ที่อยู่เดิม (เขต / ชุมชน)
	</h3>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<Form.Field {form} name="municipality_zone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>เขตเทศบาล</Form.Label>
					<SearchSelect
						items={municipalityZoneItems}
						bind:value={mzVal}
						placeholder="เลือกเขต..."
						emptyText="ไม่พบเขตที่ค้นหา"
						loading={mzPending}
						controlProps={props}
						class="h-9 w-full"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="community">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ชุมชน</Form.Label>
					<SearchSelect
						items={communityItems}
						bind:value={commVal}
						placeholder="เลือกชุมชน..."
						emptyText="ไม่พบชุมชนที่ค้นหา"
						loading={commPending}
						controlProps={props}
						class="h-9 w-full"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>
</div>

<!-- ที่อยู่ครอบครัวหลัก -->
<div class="space-y-3 border-t border-border/50 pt-4">
	<h3 class="text-xs font-semibold tracking-wide text-primary uppercase">ที่อยู่ครอบครัวหลัก</h3>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<Form.Field {form} name="housing_type">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ประเภทที่อยู่อาศัย</Form.Label>
					<Select.Root
						type="single"
						bind:value={
							() => formData.current.housing_type ?? '',
							(v) => (formData.current.housing_type = v || null)
						}
					>
						<Select.Trigger {...props} class={selectTriggerClass}>
							{housingTypeItems.find((o) => o.value === formData.current.housing_type)?.label ??
								'— เลือกประเภทที่อยู่อาศัย —'}
						</Select.Trigger>
						<Select.Content>
							{#each housingTypeItems as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="residence_landmark">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>
						จุดสังเกตที่อยู่
						{#if isHomeless}
							<span class="font-normal text-muted-foreground">(หรือบ้านเลขที่)</span>
						{/if}
					</Form.Label>
					<Input
						{...props}
						bind:value={formData.current.residence_landmark}
						placeholder={isHomeless ? 'เช่น ริมคลองข้างตลาด' : 'เช่น ใกล้สะพาน / ปากซอย'}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<Form.Field {form} name="address_no">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>
						บ้านเลขที่
						{#if isHomeless}
							<span class="font-normal text-muted-foreground">(ไม่บังคับถ้ามีจุดสังเกต)</span>
						{/if}
					</Form.Label>
					<Input {...props} bind:value={formData.current.address_no} placeholder="เช่น 123/45" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="village_no">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หมู่ / ตรอก / ซอย / ถนน</Form.Label>
					<Input {...props} bind:value={formData.current.village_no} placeholder="เช่น หมู่ 2" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="subdistrict">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ตำบล / แขวง</Form.Label>
					<Input {...props} bind:value={formData.current.subdistrict} placeholder="เช่น หาดใหญ่" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<Form.Field {form} name="district">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>อำเภอ / เขต</Form.Label>
					<Input {...props} bind:value={formData.current.district} placeholder="เช่น หาดใหญ่" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="province">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>จังหวัด</Form.Label>
					<Input {...props} bind:value={formData.current.province} placeholder="เช่น สงขลา" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="postal_code">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>รหัสไปรษณีย์</Form.Label>
					<Input {...props} bind:value={formData.current.postal_code} placeholder="เช่น 90110" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>
</div>
