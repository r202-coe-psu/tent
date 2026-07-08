<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import UserRound from '@lucide/svelte/icons/user-round';
	import type { Evacuee, HouseholdFormData } from '../domain/people';
	import type { SuperForm } from 'sveltekit-superforms';

	let {
		form,
		headItems,
		headComboValue = $bindable(),
		noHead = $bindable(false),
		allEvacuees,
		emergencyContactPhone = $bindable()
	}: {
		form: SuperForm<HouseholdFormData>;
		headItems: { value: string; label: string; evacuee: Evacuee | null }[];
		headComboValue: string;
		noHead: boolean;
		allEvacuees: Evacuee[];
		emergencyContactPhone: string;
	} = $props();

	const formData = $derived(form.form);

	$effect(() => {
		if (noHead) headComboValue = '';
	});
</script>

<!-- ชื่อเรียกครัวเรือน -->
<Form.Field {form} name="label">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>ชื่อเรียกครัวเรือน <span class="text-destructive">*</span></Form.Label>
			<Input
				{...props}
				bind:value={$formData.label}
				placeholder="เช่น บ้านสมชาย, ครอบครัวใจดี"
				required
			/>
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>

<!-- Radio: ระบุหัวหน้า / ไม่มีหัวหน้า -->
<div class="flex items-center gap-5 text-sm">
	<label class="flex cursor-pointer items-center gap-2">
		<input
			type="radio"
			name="head-mode"
			checked={!noHead}
			onchange={() => (noHead = false)}
			class="accent-primary"
		/>
		<span class="font-medium">ระบุหัวหน้าครัวเรือน</span>
	</label>
	<label class="flex cursor-pointer items-center gap-2">
		<input
			type="radio"
			name="head-mode"
			checked={noHead}
			onchange={() => (noHead = true)}
			class="accent-primary"
		/>
		<span class="font-medium">ไม่มีหัวหน้าครัวเรือน</span>
	</label>
</div>

<!-- หัวหน้าครัวเรือน -->
<Form.Field {form} name="head_evacuee_id">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label class="flex items-center gap-1.5 {noHead ? 'text-muted-foreground' : ''}">
				<UserRound class="size-3.5 text-muted-foreground" />
				หัวหน้าครัวเรือน
			</Form.Label>
			<SearchSelect
				items={headItems}
				bind:value={headComboValue}
				placeholder="พิมพ์ชื่อเพื่อค้นหา..."
				emptyText="ไม่พบผู้ประสบภัยที่ตรงกับการค้นหา"
				controlProps={props}
				class="h-9 w-full"
				disabled={noHead}
			/>
		{/snippet}
	</Form.Control>
	<Form.Description>หัวหน้าจะถูกเพิ่มเข้าสมาชิกโดยอัตโนมัติ</Form.Description>
	<Form.FieldErrors />
</Form.Field>

<!-- เบอร์ติดต่อฉุกเฉิน -->
{#if $formData.head_evacuee_id}
	{@const headEvac = allEvacuees.find((e) => e._id === $formData.head_evacuee_id)}
	{#if headEvac}
		<div class="space-y-1.5 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3">
			<Label
				for="emergency-phone"
				class="text-xs font-semibold tracking-wide text-primary uppercase"
			>
				เบอร์ติดต่อฉุกเฉินของหัวหน้าครัวเรือน <span class="text-destructive">*</span>
			</Label>
			<Input
				id="emergency-phone"
				type="tel"
				inputmode="numeric"
				placeholder="ระบุเบอร์โทรศัพท์ (ตัวเลขเท่านั้น)"
				value={emergencyContactPhone}
				oninput={(e) => {
					emergencyContactPhone = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '');
				}}
				class="bg-background"
				required
			/>
			<p class="text-[11px] text-muted-foreground">
				จะบันทึกใน emergency contact ของ {headEvac.first_name}
				{headEvac.last_name}
			</p>
		</div>
	{/if}
{/if}
