<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import UserRound from '@lucide/svelte/icons/user-round';
	import { maskNationalId } from '../domain/people';
	import type { Evacuee } from '../domain/people';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	import type { SuperForm } from 'sveltekit-superforms';

	let {
		form,
		headItems,
		headComboValue = $bindable(),
		allEvacuees,
		emergencyContactPhone = $bindable()
	}: {
		form: SuperForm<any>;
		headItems: { value: string; label: string; evacuee: Evacuee | null }[];
		headComboValue: string;
		allEvacuees: Evacuee[];
		emergencyContactPhone: string;
	} = $props();

	const formData = $derived(form.form);
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

<!-- หัวหน้าครัวเรือน -->
<Form.Field {form} name="head_evacuee_id">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label class="flex items-center gap-1.5">
				<UserRound class="size-3.5 text-muted-foreground" />
				หัวหน้าครัวเรือน
			</Form.Label>
			<Combobox
				items={headItems}
				bind:value={headComboValue}
				placeholder="พิมพ์ชื่อเพื่อค้นหา..."
				searchPlaceholder="ค้นหาผู้ประสบภัย..."
				emptyText="ไม่พบผู้ประสบภัยที่ตรงกับการค้นหา"
				controlProps={props}
				class="h-9 w-full"
			>
				{#snippet children({ item })}
					{#if item.evacuee}
						<span class="font-medium">{item.evacuee.first_name} {item.evacuee.last_name}</span>
						{#if item.evacuee.person_id?.number}
							<span class="text-xs text-muted-foreground">
								· {maskNationalId(item.evacuee.person_id.number)}
							</span>
						{/if}
					{:else}
						{item.label}
					{/if}
				{/snippet}
			</Combobox>
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
			<Label for="emergency-phone" class="text-xs font-semibold tracking-wide text-primary uppercase">
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
