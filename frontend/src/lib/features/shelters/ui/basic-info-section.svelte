<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	let {
		form,
		formData,
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	const operationStatusOptions: { value: Shelter['operation_status']; label: string }[] = [
		{ value: 'standby', label: 'เตรียมพร้อม (Standby)' },
		{ value: 'active', label: 'เปิดรับผู้อพยพ (Active)' },
		{ value: 'full_capacity', label: 'เต็มความจุ (Full Capacity)' },
		{ value: 'closed', label: 'ปิดศูนย์ (Closed)' }
	];
</script>

<section class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border p-6">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="flex h-6 w-6 items-center justify-center rounded-full bg-shelter-blue-bg text-xs font-bold text-shelter-blue-text"
			>1</span
		>
		<h2 class="text-base font-bold text-card-foreground">
			ข้อมูลพื้นฐานและที่ตั้ง (Basic Info &amp; Location)
		</h2>
	</div>

	<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">ข้อมูลหลัก</h3>

	<Form.Field {form} name="name">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>ชื่อศูนย์พักพิง<span class="text-destructive">*</span></Form.Label>
				<Input
					{...props}
					bind:value={$formData.name}
					{disabled}
					placeholder="เช่น โรงเรียนบ้านค่าย (ศูนย์พักพิงชั่วคราว)"
				/>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Form.Field {form} name="operation_status">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สถานะการปฏิบัติการ (Operating Status)</Form.Label>
					<Select.Root type="single" bind:value={$formData.operation_status} {disabled}>
						<Select.Trigger
							{...props}
							class="flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
						>
							{operationStatusOptions.find((o) => o.value === $formData.operation_status)?.label ??
								'— เลือกสถานะ —'}
						</Select.Trigger>
						<Select.Content>
							{#each operationStatusOptions as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="shelter_type">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ประเภทสถานที่</Form.Label>
					<Input
						{...props}
						bind:value={$formData.shelter_type}
						{disabled}
						placeholder="เช่น โรงเรียน, วัด, อาคารราชการ"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<Form.Field {form} name="location.address">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>ที่อยู่ตามเขตการปกครอง</Form.Label>
				<Input
					{...props}
					value={$formData.location?.address ?? ''}
					oninput={(e) => {
						if (!$formData.location) $formData.location = {};
						$formData.location.address = e.currentTarget.value;
					}}
					{disabled}
					placeholder="เช่น เทศบาลเมืองคอหงส์"
				/>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Form.Field {form} name="location.lat">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ละติจูด (Latitude)</Form.Label>
					<Input
						{...props}
						type="number"
						step="any"
						min="-90"
						max="90"
						value={$formData.location?.lat ?? ''}
						oninput={(e) => {
							if (!$formData.location) $formData.location = {};
							$formData.location.lat =
								e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
						}}
						{disabled}
						placeholder="เช่น 7.0251"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="location.lng">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ลองจิจูด (Longitude)</Form.Label>
					<Input
						{...props}
						type="number"
						step="any"
						min="-180"
						max="180"
						value={$formData.location?.lng ?? ''}
						oninput={(e) => {
							if (!$formData.location) $formData.location = {};
							$formData.location.lng =
								e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
						}}
						{disabled}
						placeholder="เช่น 100.4851"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Form.Field {form} name="contact.name">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ผู้จัดการศูนย์</Form.Label>
					<Input
						{...props}
						value={$formData.contact?.name ?? ''}
						oninput={(e) => {
							if (!$formData.contact) $formData.contact = {};
							$formData.contact.name = e.currentTarget.value;
						}}
						{disabled}
						placeholder="เช่น นาย สมชาย ใจดี"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="contact.phone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>เบอร์โทร</Form.Label>
					<Input
						{...props}
						type="tel"
						value={$formData.contact?.phone ?? ''}
						oninput={(e) => {
							if (!$formData.contact) $formData.contact = {};
							$formData.contact.phone = e.currentTarget.value;
						}}
						{disabled}
						placeholder="เช่น 074-123456"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>
</section>
