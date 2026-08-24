<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { SOP_RATIO_KEYS, RATIO_LABELS, type SopRatioKey } from '$lib/features/sop-ratios';
	import {
		scenarioInputSchema,
		type RatioOverrides,
		type ScenarioInput
	} from '../domain/scenario.schema';
	import Play from '@lucide/svelte/icons/play';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { toast } from 'svelte-sonner';
	import { overridesForScenarioMode, type ScenarioMode } from './scenario-mode';

	let {
		currentOccupancy,
		currentRatios,
		running,
		onRun,
		onDirty
	}: {
		currentOccupancy: number;
		currentRatios: Record<SopRatioKey, string>;
		running: boolean;
		onRun: (input: ScenarioInput) => void;
		onDirty: () => void;
	} = $props();

	type RatioGroupId = 'water' | 'food' | 'sanitation' | 'shelter' | 'workforce';
	type RatioGroup = { id: RatioGroupId; label: string; keys: readonly SopRatioKey[] };

	const ratioGroups: readonly RatioGroup[] = [
		{
			id: 'water',
			label: 'น้ำและจุดบริการ',
			keys: [
				'water_l_per_person_day',
				'drinking_water_l_per_person_day',
				'cooking_water_l_per_person_day',
				'hygiene_water_l_per_person_day',
				'people_per_tap',
				'people_per_handpump',
				'people_per_open_well',
				'people_per_laundry',
				'people_per_bathing',
				'max_waterpoint_distance_m',
				'max_queue_minutes'
			]
		},
		{
			id: 'food',
			label: 'อาหาร',
			keys: ['kcal_per_adult_day', 'people_per_dining_point_adult', 'people_per_dining_point_child']
		},
		{
			id: 'sanitation',
			label: 'สุขาภิบาล',
			keys: ['people_per_toilet_female', 'people_per_toilet_male']
		},
		{
			id: 'shelter',
			label: 'พื้นที่พักพิง',
			keys: ['m2_per_person_living', 'm2_per_person_living_cold', 'm2_per_person_total']
		},
		{ id: 'workforce', label: 'กำลังคน', keys: ['people_per_volunteer'] }
	];

	let enabledOverrides = $state<Partial<Record<SopRatioKey, boolean>>>({});
	let ratioValues = $state<RatioOverrides>({});
	let ratioDialogOpen = $state(false);
	let activeGroup = $state<RatioGroupId>('water');
	let ratioSearch = $state('');
	let mode = $state<ScenarioMode>('general');
	const enabledKeys = $derived(SOP_RATIO_KEYS.filter((key) => enabledOverrides[key]));
	const visibleRatioKeys = $derived.by(() => {
		const query = ratioSearch.trim().toLocaleLowerCase('th-TH');
		if (query)
			return SOP_RATIO_KEYS.filter((key) => {
				const meta = RATIO_LABELS[key];
				return `${meta.label} ${meta.unit} ${meta.description}`
					.toLocaleLowerCase('th-TH')
					.includes(query);
			});
		return ratioGroups.find((group) => group.id === activeGroup)?.keys ?? [];
	});

	const initial = () => ({ name: '', occupancy: currentOccupancy, days: 14, ratio_overrides: {} });
	const form = superForm(defaults(initial(), zod4(scenarioInputSchema)), {
		id: 'sop-what-if-scenario',
		SPA: true,
		dataType: 'json',
		validators: zod4(scenarioInputSchema),
		onUpdate: ({ form: updated }) => {
			if (updated.valid) onRun(updated.data);
			else toast.error('ตรวจสอบชื่อสถานการณ์ จำนวนผู้พักพิง จำนวนวัน และอัตรามาตรฐาน');
		}
	});
	const { form: formData, enhance, reset } = form;

	function markDirty() {
		onDirty();
	}
	function prepareOverrides() {
		const draft: RatioOverrides = {};
		for (const key of SOP_RATIO_KEYS)
			if (enabledOverrides[key] && ratioValues[key]) draft[key] = ratioValues[key];
		$formData.ratio_overrides = overridesForScenarioMode(mode, draft);
	}
	function setMode(nextMode: ScenarioMode) {
		if (mode === nextMode) return;
		mode = nextMode;
		$formData.ratio_overrides = {};
		markDirty();
	}
	function toggleOverride(key: SopRatioKey, enabled: boolean) {
		enabledOverrides[key] = enabled;
		if (enabled) ratioValues[key] = currentRatios[key];
		else delete ratioValues[key];
		markDirty();
	}
	function resetForm() {
		enabledOverrides = {};
		ratioValues = {};
		ratioSearch = '';
		activeGroup = 'water';
		mode = 'general';
		reset({ data: initial() });
		markDirty();
	}
</script>

<form method="POST" use:enhance class="scenario-form">
	<div class="scenario-mode" role="tablist" aria-label="รูปแบบการจำลอง">
		<button
			type="button"
			role="tab"
			aria-selected={mode === 'general'}
			class:active={mode === 'general'}
			onclick={() => setMode('general')}
		>
			<UsersRound class="size-4" aria-hidden="true" />
			<span><strong>จำลองทั่วไป</strong><small>เปลี่ยนจำนวนคนและวัน</small></span>
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={mode === 'sop_override'}
			class:active={mode === 'sop_override'}
			onclick={() => setMode('sop_override')}
		>
			<SlidersHorizontal class="size-4" aria-hidden="true" />
			<span><strong>ปรับเกณฑ์ใน Scenario</strong><small>สมมุติอัตรา SOP เพิ่มเติม</small></span>
			{#if enabledKeys.length > 0}<b>{enabledKeys.length}</b>{/if}
		</button>
	</div>

	<div class="scenario-fields">
		<Form.Field {form} name="name">
			<Form.Control
				>{#snippet children({ props })}<Form.Label
						>ชื่อสถานการณ์ <span class="text-muted-foreground">(จำเป็น)</span></Form.Label
					><Input
						{...props}
						bind:value={$formData.name}
						placeholder="เช่น น้ำท่วมต่อเนื่อง 14 วัน"
						oninput={markDirty}
					/>{/snippet}</Form.Control
			>
			<Form.FieldErrors />
		</Form.Field>
		<div class="scenario-number-fields">
			<Form.Field {form} name="occupancy">
				<Form.Control
					>{#snippet children({ props })}<Form.Label>ผู้พักพิงในสถานการณ์</Form.Label>
						<div class="input-with-unit">
							<Input
								{...props}
								type="number"
								min="0"
								step="1"
								bind:value={$formData.occupancy}
								oninput={markDirty}
							/><span>คน</span>
						</div>{/snippet}</Form.Control
				>
				<Form.FieldErrors />
			</Form.Field>
			<Form.Field {form} name="days">
				<Form.Control
					>{#snippet children({ props })}<Form.Label>ระยะเวลาสถานการณ์</Form.Label>
						<div class="input-with-unit">
							<Input
								{...props}
								type="number"
								min="1"
								max="365"
								step="1"
								bind:value={$formData.days}
								oninput={markDirty}
							/><span>วัน</span>
						</div>{/snippet}</Form.Control
				>
				<Form.FieldErrors />
			</Form.Field>
		</div>
	</div>

	{#if mode === 'sop_override'}
		<section class="ratio-summary" aria-labelledby="ratio-summary-title">
			<div class="ratio-summary-copy">
				<div class="ratio-summary-icon"><SlidersHorizontal class="size-4" /></div>
				<div>
					<div class="ratio-summary-title-row">
						<h3 id="ratio-summary-title">ปรับอัตรามาตรฐาน</h3>
						<span>{enabledKeys.length}/{SOP_RATIO_KEYS.length}</span>
					</div>
					<p>
						{enabledKeys.length === 0
							? 'ใช้ค่าปัจจุบันทั้งหมด'
							: `เปลี่ยนเฉพาะ ${enabledKeys.length} รายการในสถานการณ์นี้`}
					</p>
				</div>
			</div>
			<Button type="button" variant="outline" size="sm" onclick={() => (ratioDialogOpen = true)}
				>{enabledKeys.length === 0 ? 'เลือกค่าที่จะปรับ' : 'แก้ไขค่าที่เลือก'}</Button
			>
			{#if enabledKeys.length > 0}
				<div class="ratio-selected-list" aria-live="polite">
					{#each enabledKeys.slice(0, 4) as key (key)}
						<button
							type="button"
							class="ratio-selected-chip"
							onclick={() => toggleOverride(key, false)}
							><span>{RATIO_LABELS[key].label}</span><strong>{ratioValues[key]}</strong><X
								class="size-3.5"
								aria-hidden="true"
							/></button
						>
					{/each}
					{#if enabledKeys.length > 4}<span class="ratio-more"
							>+{enabledKeys.length - 4} รายการ</span
						>{/if}
				</div>
			{/if}
		</section>
	{:else}
		<div class="current-sop-note">
			<SlidersHorizontal class="size-4" aria-hidden="true" />
			<div><strong>ใช้เกณฑ์ SOP ปัจจุบัน</strong><span>โหมดนี้ไม่ส่งค่าปรับเกณฑ์ไปคำนวณ</span></div>
		</div>
	{/if}

	<div class="scenario-actions">
		<Button type="button" variant="ghost" onclick={resetForm} disabled={running}
			><RotateCcw class="size-4" /> ล้างค่า</Button
		>
		<Button type="submit" onclick={prepareOverrides} disabled={running} class="scenario-run-button"
			><Play class="size-4" />{running ? 'กำลังคำนวณ…' : 'รันสถานการณ์'}</Button
		>
	</div>

	<Dialog.Root bind:open={ratioDialogOpen}>
		<Dialog.Content class="ratio-dialog max-h-[86dvh] overflow-hidden p-0 sm:max-w-5xl">
			<Dialog.Header class="border-b px-5 py-4 text-left"
				><Dialog.Title>เลือกอัตรามาตรฐานที่ต้องการเปลี่ยน</Dialog.Title><Dialog.Description
					>ค่าที่เปลี่ยนใช้เฉพาะการจำลองครั้งนี้ ไม่แก้ SOP ปัจจุบัน</Dialog.Description
				></Dialog.Header
			>
			<div class="ratio-dialog-toolbar">
				<Search class="size-4" aria-hidden="true" /><label for="ratio-search" class="sr-only"
					>ค้นหาอัตรามาตรฐาน</label
				><Input id="ratio-search" bind:value={ratioSearch} placeholder="ค้นหาชื่อหรือหน่วย…" /><span
					>{enabledKeys.length} รายการที่เปลี่ยน</span
				>
			</div>
			<div class="ratio-dialog-body">
				<nav class="ratio-groups" aria-label="หมวดอัตรามาตรฐาน">
					{#each ratioGroups as group (group.id)}
						<button
							type="button"
							class:active={activeGroup === group.id && ratioSearch.length === 0}
							onclick={() => {
								activeGroup = group.id;
								ratioSearch = '';
							}}
							><span>{group.label}</span><small
								>{group.keys.filter((key) => enabledOverrides[key]).length}/{group.keys
									.length}</small
							></button
						>
					{/each}
				</nav>
				<div class="ratio-options" aria-label={`รายการอัตรามาตรฐาน ${visibleRatioKeys.length} ค่า`}>
					{#each visibleRatioKeys as key (key)}
						{@const meta = RATIO_LABELS[key]}
						<div class="ratio-option" class:active={enabledOverrides[key]}>
							<div class="ratio-option-heading">
								<div>
									<p>{meta.label}</p>
								</div>
								<Switch
									checked={enabledOverrides[key] ?? false}
									onCheckedChange={(checked) => toggleOverride(key, checked)}
									aria-label={`เปลี่ยนค่า ${meta.label}`}
								/>
							</div>
							<div class="ratio-option-values" class:has-scenario={enabledOverrides[key]}>
								<div>
									<span>อัตราปัจจุบัน</span><strong>{currentRatios[key]}</strong><small
										>{meta.unit}</small
									>
								</div>
								{#if enabledOverrides[key]}<div class="scenario-value">
										<label for={`scenario-ratio-${key}`}>อัตราใน Scenario</label><Input
											id={`scenario-ratio-${key}`}
											type="number"
											min="0.0001"
											step="any"
											value={ratioValues[key] ?? ''}
											oninput={(event) => {
												ratioValues[key] = event.currentTarget.value;
												markDirty();
											}}
										/><small>{meta.unit}</small>
									</div>{/if}
							</div>
						</div>
					{/each}
					{#if visibleRatioKeys.length === 0}<p class="ratio-empty">ไม่พบค่าที่ตรงกับคำค้น</p>{/if}
				</div>
			</div>
			<div class="ratio-dialog-footer">
				<p>ปิดสวิตช์เพื่อกลับไปใช้ค่าปัจจุบัน</p>
				<Button type="button" onclick={() => (ratioDialogOpen = false)}>เสร็จสิ้น</Button>
			</div>
		</Dialog.Content>
	</Dialog.Root>
</form>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Bento Grid · theme: SmartShelter cobalt · enrichment: none · nav: inherited · footer: inherited */
	.scenario-form {
		display: grid;
		gap: 1rem;
	}
	.scenario-mode {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.3rem;
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		background: var(--muted);
		padding: 0.3rem;
	}
	.scenario-mode button {
		display: flex;
		position: relative;
		min-width: 0;
		min-height: 3.25rem;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		padding: 0.45rem 0.55rem;
		text-align: start;
		color: var(--muted-foreground);
	}
	.scenario-mode button.active {
		border-color: var(--border);
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(
			--sim-panel-shadow,
			0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent)
		);
	}
	.scenario-mode button > span {
		display: grid;
		min-width: 0;
		gap: 0.05rem;
	}
	.scenario-mode strong {
		font-size: 0.74rem;
		white-space: nowrap;
	}
	.scenario-mode small {
		overflow: hidden;
		font-size: 0.62rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scenario-mode b {
		display: grid;
		flex: 0 0 auto;
		min-width: 1.25rem;
		height: 1.25rem;
		place-items: center;
		border-radius: 999px;
		background: var(--primary-muted);
		font-size: 0.62rem;
		color: var(--primary);
	}
	.current-sop-note {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		padding-block: 0.7rem;
		color: var(--primary);
	}
	.current-sop-note > div {
		display: grid;
		gap: 0.05rem;
	}
	.current-sop-note strong {
		font-size: 0.76rem;
		color: var(--foreground);
	}
	.current-sop-note span {
		font-size: 0.66rem;
		color: var(--muted-foreground);
	}
	.scenario-fields {
		display: grid;
		gap: 0.85rem;
	}
	.scenario-number-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
	.input-with-unit {
		position: relative;
	}
	.input-with-unit :global(input) {
		padding-inline-end: 3rem;
		font-variant-numeric: tabular-nums;
	}
	.input-with-unit > span {
		position: absolute;
		inset-inline-end: 0.75rem;
		top: 50%;
		translate: 0 -50%;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--muted-foreground);
		pointer-events: none;
	}
	.ratio-summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 0.1rem);
		background: var(--muted);
		padding: 0.85rem;
	}
	.ratio-summary-copy {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}
	.ratio-summary-icon {
		display: grid;
		flex: 0 0 auto;
		width: 2.1rem;
		height: 2.1rem;
		place-items: center;
		border-radius: 0.55rem;
		background: var(--primary-muted);
		color: var(--primary);
	}
	.ratio-summary-title-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.ratio-summary-title-row h3 {
		font-size: 0.84rem;
		font-weight: 800;
	}
	.ratio-summary-title-row span,
	.ratio-more {
		border-radius: 999px;
		background: var(--background);
		padding: 0.15rem 0.4rem;
		font-size: 0.65rem;
		font-weight: 750;
		color: var(--muted-foreground);
	}
	.ratio-summary-copy p {
		margin-top: 0.15rem;
		font-size: 0.7rem;
		color: var(--muted-foreground);
	}
	.ratio-selected-list {
		display: flex;
		grid-column: 1 / -1;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		border-top: 1px solid var(--border);
		padding-top: 0.65rem;
	}
	.ratio-selected-chip {
		display: inline-flex;
		min-height: 2rem;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid color-mix(in srgb, var(--primary) 35%, var(--border));
		border-radius: 0.45rem;
		background: var(--background);
		padding: 0.3rem 0.45rem;
		font-size: 0.68rem;
		color: var(--foreground);
	}
	.ratio-selected-chip strong {
		font-variant-numeric: tabular-nums;
		color: var(--primary);
	}
	.scenario-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}
	:global(.scenario-run-button) {
		min-width: 9.5rem;
		white-space: nowrap;
	}
	.ratio-dialog-toolbar {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		border-bottom: 1px solid var(--border);
		padding: 0.75rem 1.25rem;
		color: var(--muted-foreground);
	}
	.ratio-dialog-toolbar span {
		font-size: 0.72rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.ratio-dialog-body {
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr);
		min-height: 25rem;
		max-height: 58dvh;
	}
	.ratio-groups {
		display: grid;
		align-content: start;
		gap: 0.35rem;
		border-inline-end: 1px solid var(--border);
		background: var(--muted);
		padding: 0.75rem;
	}
	.ratio-groups button {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border-radius: 0.5rem;
		padding: 0.55rem 0.65rem;
		text-align: start;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--muted-foreground);
	}
	.ratio-groups button.active {
		background: var(--primary);
		color: var(--primary-foreground);
	}
	.ratio-groups small {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}
	.ratio-options {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-content: start;
		gap: 0.6rem;
		overflow-y: auto;
		padding: 0.8rem;
	}
	.ratio-option {
		display: grid;
		align-content: start;
		gap: 0.65rem;
		min-height: 7rem;
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		background: var(--background);
		padding: 0.75rem;
	}
	.ratio-option.active {
		border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
		background: color-mix(in srgb, var(--primary) 4%, var(--background));
	}
	.ratio-option-heading,
	.ratio-option-values {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.ratio-option-heading p {
		font-size: 0.8rem;
		font-weight: 800;
	}
	.ratio-option-values span,
	.ratio-option-values label,
	.ratio-option-values small {
		display: block;
		font-size: 0.64rem;
		color: var(--muted-foreground);
	}
	.ratio-option-values strong {
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.ratio-option-values.has-scenario {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: end;
		border-top: 1px solid var(--border);
		padding-top: 0.6rem;
	}
	.ratio-option-values .scenario-value {
		border-inline-start: 1px solid var(--border);
		padding-inline-start: 0.75rem;
	}
	.ratio-option-values :global(input) {
		height: 2rem;
		font-variant-numeric: tabular-nums;
	}
	.ratio-empty {
		grid-column: 1 / -1;
		padding: 4rem 1rem;
		text-align: center;
		font-size: 0.8rem;
		color: var(--muted-foreground);
	}
	.ratio-dialog-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-top: 1px solid var(--border);
		padding: 0.75rem 1.25rem;
	}
	.ratio-dialog-footer p {
		font-size: 0.7rem;
		color: var(--muted-foreground);
	}
	@media (hover: hover) and (pointer: fine) {
		.scenario-mode button:not(.active):hover,
		.ratio-selected-chip:hover,
		.ratio-groups button:not(.active):hover {
			background: var(--accent);
			color: var(--accent-foreground);
		}
	}
	@media (max-width: 48rem) {
		.ratio-dialog-body {
			grid-template-columns: 1fr;
		}
		.ratio-groups {
			display: flex;
			overflow-x: auto;
			border-inline-end: 0;
			border-bottom: 1px solid var(--border);
		}
		.ratio-groups button {
			flex: 0 0 auto;
			white-space: nowrap;
		}
		.ratio-options {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 32rem) {
		.scenario-mode {
			grid-template-columns: 1fr;
		}
		.scenario-number-fields,
		.ratio-summary {
			grid-template-columns: 1fr;
		}
		.ratio-summary :global(button) {
			width: 100%;
		}
		.scenario-actions {
			justify-content: stretch;
		}
		.scenario-actions :global(button) {
			flex: 1 1 0;
		}
		.ratio-dialog-toolbar {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.ratio-dialog-toolbar span {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scenario-form :global(*) {
			scroll-behavior: auto !important;
		}
	}
</style>
