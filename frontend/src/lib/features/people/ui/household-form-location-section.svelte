<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import type { SuperForm } from 'sveltekit-superforms';
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

	const formData = $derived(form.form);
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
						placeholder={mzPending ? 'กำลังโหลด...' : 'เลือกเขต...'}
						emptyText="ไม่พบเขตที่ค้นหา"
						disabled={mzPending}
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
						placeholder={commPending ? 'กำลังโหลด...' : 'เลือกชุมชน...'}
						emptyText="ไม่พบชุมชนที่ค้นหา"
						disabled={commPending}
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

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<Form.Field {form} name="address_no">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>บ้านเลขที่</Form.Label>
					<Input {...props} bind:value={$formData.address_no} placeholder="เช่น 123/45" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="village_no">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หมู่ / ตรอก / ซอย / ถนน</Form.Label>
					<Input {...props} bind:value={$formData.village_no} placeholder="เช่น หมู่ 2" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="subdistrict">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ตำบล / แขวง</Form.Label>
					<Input {...props} bind:value={$formData.subdistrict} placeholder="เช่น หาดใหญ่" />
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
					<Input {...props} bind:value={$formData.district} placeholder="เช่น หาดใหญ่" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="province">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>จังหวัด</Form.Label>
					<Input {...props} bind:value={$formData.province} placeholder="เช่น สงขลา" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="postal_code">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>รหัสไปรษณีย์</Form.Label>
					<Input {...props} bind:value={$formData.postal_code} placeholder="เช่น 90110" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>
</div>
