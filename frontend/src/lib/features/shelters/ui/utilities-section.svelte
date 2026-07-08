<script lang="ts">
	import Zap from '@lucide/svelte/icons/zap';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, PowerSource, WaterSource, CommunicationChannel } from '../domain/schema';
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

	const powerSourceOptions: { value: PowerSource; label: string }[] = [
		{ value: 'city_grid', label: '🔌 ไฟฟ้านครหลวง/ภูมิภาค (City Grid)' },
		{ value: 'generator', label: '⚡ เครื่องปั่นไฟ (Generator)' },
		{ value: 'solar', label: '☀️ โซลาร์เซลล์ (Solar)' }
	];

	const waterSourceOptions: { value: WaterSource; label: string }[] = [
		{ value: 'city_water', label: '💧 น้ำประปา (City Water)' },
		{ value: 'water_tank', label: '🛢 แท็งก์น้ำสำรอง (Water Tank)' },
		{ value: 'groundwater', label: '⛲ บ่อบาดาล (Groundwater)' }
	];

	const communicationOptions: { value: CommunicationChannel; label: string; icon: string }[] = [
		{ value: 'cellular', label: 'สัญญาณมือถือ (Cellular)', icon: '📱' },
		{ value: 'wifi', label: 'Wi-Fi ของศูนย์', icon: '🌐' },
		{ value: 'vhf_radio', label: 'วิทยุสื่อสาร VHF (Analog/Local)', icon: '📻' }
	];

	function toggleComm(value: CommunicationChannel) {
		const current = $formData.utilities.communications ?? [];
		const next = current.includes(value)
			? current.filter((c: string) => c !== value)
			: [...current, value];
		$formData.utilities = { ...$formData.utilities, communications: next };
		// Clear vhf_channel if vhf_radio removed
		if (value === 'vhf_radio' && !next.includes('vhf_radio')) {
			$formData.utilities = { ...$formData.utilities, vhf_channel: null };
		}
	}

	const showVhfChannel = $derived(($formData.utilities.communications ?? []).includes('vhf_radio'));
</script>

<section class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border p-6">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<Zap class="h-5 w-5 text-shelter-blue-text" />
		<span class="text-sm font-bold text-muted-foreground">4.</span>
		<h2 class="text-base font-bold text-card-foreground">สถานะสาธารณูปโภคพื้นฐาน (Utilities)</h2>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Form.Field {form} name="utilities.power_source">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>แหล่งพลังงานหลัก</Form.Label>
					<Select.Root
						type="single"
						value={$formData.utilities.power_source ?? ''}
						onValueChange={(v) =>
							($formData.utilities = {
								...$formData.utilities,
								power_source: (v || null) as PowerSource | null
							})}
						{disabled}
					>
						<Select.Trigger
							{...props}
							class="flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
						>
							{powerSourceOptions.find((o) => o.value === $formData.utilities.power_source)
								?.label ?? '— เลือก —'}
						</Select.Trigger>
						<Select.Content>
							{#each powerSourceOptions as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="utilities.water_source">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>แหล่งน้ำหลัก</Form.Label>
					<Select.Root
						type="single"
						value={$formData.utilities.water_source ?? ''}
						onValueChange={(v) =>
							($formData.utilities = {
								...$formData.utilities,
								water_source: (v || null) as WaterSource | null
							})}
						{disabled}
					>
						<Select.Trigger
							{...props}
							class="flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
						>
							{waterSourceOptions.find((o) => o.value === $formData.utilities.water_source)
								?.label ?? '— เลือก —'}
						</Select.Trigger>
						<Select.Content>
							{#each waterSourceOptions as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<Form.Field {form} name="utilities.communications">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>ระบบสื่อสารที่มี (เลือกได้หลายตัว)</Form.Label>
				<div class="grid grid-cols-1 gap-2 md:grid-cols-3">
					{#each communicationOptions as opt (opt.value)}
						{@const isSelected = ($formData.utilities.communications ?? []).includes(opt.value)}
						<button
							type="button"
							{...props}
							onclick={() => toggleComm(opt.value)}
							{disabled}
							class="flex items-center justify-center gap-2 rounded-xl border py-3.5 text-sm font-bold transition-colors {isSelected
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border bg-background hover:bg-muted'}"
						>
							<span>{opt.icon}</span>
							<span>{opt.label}</span>
						</button>
					{/each}
				</div>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	{#if showVhfChannel}
		<Form.Field {form} name="utilities.vhf_channel">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>คลื่นความถี่ VHF (free text)</Form.Label>
					<Input
						{...props}
						bind:value={$formData.utilities.vhf_channel}
						{disabled}
						placeholder="เช่น CH-16 / KHO-01"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	{/if}
</section>
