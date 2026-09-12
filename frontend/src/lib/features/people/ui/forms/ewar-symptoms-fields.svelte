<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Thermometer from '@lucide/svelte/icons/thermometer';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { EWAR_SYMPTOM_GROUPS } from '$lib/features/people';

	let {
		symptoms = $bindable<string[]>([]),
		temperature_c = $bindable<number | null>(null),
		disabled = false,
		showTemperature = true,
		temperatureError
	}: {
		symptoms?: string[];
		temperature_c?: number | null;
		disabled?: boolean;
		showTemperature?: boolean;
		temperatureError?: string;
	} = $props();

	function toggleSymptom(id: string) {
		if (disabled) return;
		symptoms = symptoms.includes(id)
			? symptoms.filter((symptomId) => symptomId !== id)
			: [...symptoms, id];
	}

	function onTemperatureInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		const val = target.value.trim();
		if (!val) {
			temperature_c = null;
			return;
		}
		const num = parseFloat(val);
		temperature_c = isNaN(num) ? null : num;
	}

	const tempValidationMsg = $derived.by(() => {
		if (temperatureError) return temperatureError;
		if (temperature_c === null || temperature_c === undefined) return '';
		if (!Number.isFinite(temperature_c)) return 'กรุณากรอกอุณหภูมิเป็นตัวเลข';
		if (temperature_c < 30 || temperature_c > 45) return 'อุณหภูมิต้องอยู่ระหว่าง 30 ถึง 45 °C';
		return '';
	});
</script>

<div class="space-y-4">
	{#if showTemperature}
		<div class="space-y-1.5">
			<Label
				for="ewar-temperature"
				class="flex items-center gap-1.5 text-xs font-semibold text-foreground"
			>
				<Thermometer class="size-3.5 text-muted-foreground" />
				อุณหภูมิร่างกาย (°C)
			</Label>
			<div class="flex max-w-xs items-center gap-2">
				<Input
					id="ewar-temperature"
					type="number"
					inputmode="decimal"
					step="0.1"
					min="30"
					max="45"
					value={temperature_c ?? ''}
					oninput={onTemperatureInput}
					{disabled}
					placeholder="เช่น 36.8"
					class="h-9"
				/>
				<span class="text-xs text-muted-foreground">°C</span>
			</div>
			{#if tempValidationMsg}
				<p class="text-2xs text-destructive">{tempValidationMsg}</p>
			{/if}
		</div>
	{/if}

	<div class="space-y-2">
		<div class="flex items-center justify-between border-b border-border pb-2">
			<h4 class="text-xs font-semibold text-foreground">
				อาการเฝ้าระวัง (EWAR Symptoms Checklist)
			</h4>
			{#if symptoms.length > 0}
				<span class="text-2xs font-semibold text-red-600 dark:text-red-400">
					เลือกแล้ว {symptoms.length} รายการ
				</span>
			{/if}
		</div>

		<div class="grid grid-cols-1 gap-2.5 md:grid-cols-2">
			{#each EWAR_SYMPTOM_GROUPS as group (group.title)}
				<div class="overflow-hidden rounded-lg border border-border bg-card">
					<div
						class="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5"
					>
						<span class="text-2xs font-bold text-foreground">{group.title}</span>
						<span class="text-2xs text-muted-foreground">
							{group.symptoms.filter((symptom) => symptoms.includes(symptom.id)).length}/{group
								.symptoms.length}
						</span>
					</div>
					<div class="space-y-1 p-2">
						{#each group.symptoms as symptom (symptom.id)}
							{@const checked = symptoms.includes(symptom.id)}
							<button
								type="button"
								role="checkbox"
								aria-checked={checked}
								aria-label={symptom.label}
								{disabled}
								onclick={() => toggleSymptom(symptom.id)}
								class="flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 {checked
									? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/35 dark:text-red-100'
									: 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground'}"
							>
								<span
									class="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border {checked
										? 'border-red-600 bg-red-600 text-white'
										: 'border-muted-foreground/50 bg-background'}"
								>
									{#if checked}<Check class="size-2.5" aria-hidden="true" />{/if}
								</span>
								<span class="leading-snug">{symptom.label}</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
