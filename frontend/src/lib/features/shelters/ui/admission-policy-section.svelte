<script lang="ts">
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, PetCategory, PetCategoryEntry, PetCondition } from '../domain/schema';
	import {
		petCategoryLabels,
		petCategoryConditions,
		petConditionLabels,
		petCategoryOrder
	} from '../domain/policy-labels';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { useMasterData } from '$lib/features/master-data';

	let {
		formData,
		disabled = false
	}: {
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	const vulnerableGroups = $derived(
		(vulnerableGroupQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.label }))
	);

	const selectedVulnerable = $derived(
		$formData.admission_policy?.supported_vulnerable_groups ?? []
	);
	const knownVulnerableCodes = $derived(new Set(vulnerableGroups.map((g) => g.value)));
	// Codes stored on this shelter that no longer exist in the master list.
	// Gate on `isSuccess` so valid selections are not flagged as orphans while
	// the master query is still loading (empty list → everything looks orphaned).
	const orphanVulnerable = $derived(
		vulnerableGroupQuery.isSuccess
			? selectedVulnerable.filter((code) => !knownVulnerableCodes.has(code))
			: []
	);

	/** Each pet category has its own condition whitelist (CR-023 Addendum A, D-A2 revised). */
	const petCategories: {
		value: PetCategory;
		label: string;
		conditions: { value: PetCondition; label: string }[];
	}[] = petCategoryOrder.map((cat) => ({
		value: cat,
		label: petCategoryLabels[cat],
		conditions: petCategoryConditions[cat].map((cond) => ({
			value: cond,
			label: petConditionLabels[cond]
		}))
	}));

	function ensurePolicy() {
		if (!$formData.admission_policy) {
			$formData.admission_policy = {
				supported_vulnerable_groups: [],
				pet_policy: { policy: null, categories: [] }
			};
		}
		if (!$formData.admission_policy.pet_policy) {
			$formData.admission_policy.pet_policy = { policy: null, categories: [] };
		}
	}

	function toggleVulnerable(code: string, checked: boolean) {
		ensurePolicy();
		const cur = $formData.admission_policy!.supported_vulnerable_groups ?? [];
		$formData.admission_policy!.supported_vulnerable_groups = checked
			? [...new Set([...cur, code])]
			: cur.filter((c) => c !== code);
	}

	function setPetPolicy(value: 'no_pets' | 'conditional') {
		ensurePolicy();
		$formData.admission_policy!.pet_policy = {
			policy: value,
			// no_pets clears all category detail (FR-23-21).
			categories:
				value === 'conditional' ? ($formData.admission_policy!.pet_policy?.categories ?? []) : []
		};
	}

	function categoryEntry(cat: PetCategory) {
		return $formData.admission_policy?.pet_policy?.categories?.find((c) => c.category === cat);
	}

	// TS narrows `.includes()`'s argument to `never` for a union of differently-typed
	// arrays; widening the return type here keeps the template's `.includes` check simple.
	function conditionsOf(entry: PetCategoryEntry): PetCondition[] {
		return entry.conditions ?? [];
	}

	function newEntry(cat: PetCategory): PetCategoryEntry {
		if (cat === 'livestock') {
			return { category: cat, max_capacity: null, location: null, conditions: [], other: null };
		}
		return { category: cat, conditions: [], other: null };
	}

	function toggleCategory(cat: PetCategory, checked: boolean) {
		ensurePolicy();
		const cats = $formData.admission_policy!.pet_policy!.categories ?? [];
		$formData.admission_policy!.pet_policy!.categories = checked
			? [...cats, newEntry(cat)]
			: cats.filter((c) => c.category !== cat);
	}

	function toggleCondition(cat: PetCategory, cond: PetCondition, checked: boolean) {
		ensurePolicy();
		$formData.admission_policy!.pet_policy!.categories = (
			$formData.admission_policy!.pet_policy!.categories ?? []
		).map((c): PetCategoryEntry => {
			if (c.category !== cat) return c;
			// Each branch keeps its own literal condition type — the array-typed
			// discriminated union only narrows correctly per-branch, not generically.
			if (c.category === 'small_general') {
				const cs = c.conditions ?? [];
				return {
					...c,
					conditions: checked
						? [...new Set([...cs, cond as (typeof cs)[number]])]
						: cs.filter((x) => x !== cond)
				};
			}
			if (c.category === 'large_dog') {
				const cs = c.conditions ?? [];
				return {
					...c,
					conditions: checked
						? [...new Set([...cs, cond as (typeof cs)[number]])]
						: cs.filter((x) => x !== cond)
				};
			}
			const cs = c.conditions ?? [];
			return {
				...c,
				conditions: checked
					? [...new Set([...cs, cond as (typeof cs)[number]])]
					: cs.filter((x) => x !== cond)
			};
		});
	}

	function setCategoryOther(cat: PetCategory, text: string) {
		ensurePolicy();
		$formData.admission_policy!.pet_policy!.categories = (
			$formData.admission_policy!.pet_policy!.categories ?? []
		).map((c) => (c.category === cat ? { ...c, other: text || null } : c));
	}

	function setLivestockCapacity(text: string) {
		ensurePolicy();
		$formData.admission_policy!.pet_policy!.categories = (
			$formData.admission_policy!.pet_policy!.categories ?? []
		).map((c) =>
			c.category === 'livestock' ? { ...c, max_capacity: text === '' ? null : Number(text) } : c
		);
	}

	function setLivestockLocation(text: string) {
		ensurePolicy();
		$formData.admission_policy!.pet_policy!.categories = (
			$formData.admission_policy!.pet_policy!.categories ?? []
		).map((c) => (c.category === 'livestock' ? { ...c, location: text || null } : c));
	}

	const petPolicy = $derived($formData.admission_policy?.pet_policy?.policy ?? null);
</script>

<section
	class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border bg-shelter-amber-bg/20 p-6"
>
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<PawPrint class="text-shelter-orange-text h-5 w-5" />
		<span class="text-sm font-bold text-black">6.</span>
		<h2 class="text-base font-bold text-black">นโยบายการรับผู้อพยพและกลุ่มเปราะบาง</h2>
	</div>

	<!-- Vulnerable groups -->
	<div class="space-y-3">
		<h3 class="text-sm font-bold text-card-foreground">
			กลุ่มเปราะบางที่ศูนย์รองรับได้ (Supported Vulnerable Groups)
		</h3>
		{#if vulnerableGroups.length === 0 && orphanVulnerable.length === 0}
			<p class="text-sm text-muted-foreground">
				ยังไม่มีข้อมูลกลุ่มเปราะบาง — เพิ่มได้ที่หน้า “ตั้งค่าข้อมูลลงทะเบียน”
			</p>
		{:else}
			<div class="space-y-2">
				{#each vulnerableGroups as group (group.value)}
					<label
						class="flex items-center space-x-3 rounded-lg border border-shelter-border bg-background p-3 text-sm"
					>
						<Checkbox
							checked={selectedVulnerable.includes(group.value)}
							onCheckedChange={(v) => toggleVulnerable(group.value, v === true)}
							{disabled}
						/>
						<span>{group.label}</span>
					</label>
				{/each}

				{#each orphanVulnerable as code (code)}
					<label
						class="flex items-center space-x-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
					>
						<Checkbox
							checked={true}
							onCheckedChange={(v) => toggleVulnerable(code, v === true)}
							{disabled}
						/>
						<span class="flex flex-col">
							<span class="font-mono text-xs">{code}</span>
							<span class="text-xs text-destructive">ถูกลบจากมาสเตอร์แล้ว — ติ๊กออกเพื่อลบ</span>
						</span>
					</label>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Pet policy -->
	<div class="space-y-3">
		<h3 class="text-sm font-bold text-card-foreground">นโยบายการรับสัตว์เลี้ยง (Pet Policy)</h3>

		<div class="space-y-2 rounded-lg border border-shelter-border bg-background p-3">
			<label class="flex items-center space-x-3 text-sm">
				<input
					type="radio"
					name="pet-policy"
					value="no_pets"
					checked={petPolicy === 'no_pets'}
					onchange={() => setPetPolicy('no_pets')}
					{disabled}
					class="h-4 w-4 accent-shelter-blue-text"
				/>
				<span>🚫 ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าศูนย์ (No Pets Allowed)</span>
			</label>
			<label class="flex items-center space-x-3 text-sm">
				<input
					type="radio"
					name="pet-policy"
					value="conditional"
					checked={petPolicy === 'conditional'}
					onchange={() => setPetPolicy('conditional')}
					{disabled}
					class="h-4 w-4 accent-shelter-blue-text"
				/>
				<span>✅ อนุญาตให้นำสัตว์เลี้ยงเข้าได้ภายใต้เงื่อนไข (Pets Allowed with Conditions)</span>
			</label>
		</div>

		{#if petPolicy === 'conditional'}
			<div class="space-y-3">
				{#each petCategories as cat (cat.value)}
					{@const entry = categoryEntry(cat.value)}
					<div class="rounded-lg border border-shelter-border bg-background p-3">
						<label class="flex items-center space-x-3 text-sm font-medium">
							<Checkbox
								checked={!!entry}
								onCheckedChange={(v) => toggleCategory(cat.value, v === true)}
								{disabled}
							/>
							<span>{cat.label}</span>
						</label>

						{#if entry}
							<div class="mt-3 space-y-2 border-t border-shelter-border pt-3 pl-7">
								{#if entry.category === 'livestock'}
									<div class="flex items-center gap-2 pb-1">
										<span class="shrink-0 text-sm text-muted-foreground">จำนวนรองรับสูงสุด:</span>
										<Input
											type="number"
											min="0"
											value={entry.max_capacity ?? ''}
											oninput={(e) => setLivestockCapacity(e.currentTarget.value)}
											{disabled}
											class="w-24"
											placeholder="0"
										/>
										<span class="text-sm text-muted-foreground">ตัว</span>
									</div>
									<div class="flex items-center gap-2 pb-1">
										<span class="shrink-0 text-sm text-muted-foreground">พิกัด/สถานที่จัดเก็บ:</span
										>
										<Input
											value={entry.location ?? ''}
											oninput={(e) => setLivestockLocation(e.currentTarget.value)}
											{disabled}
											class="flex-1"
											placeholder="เช่น สนามหญ้าหลังอาคารเรียน"
										/>
									</div>
								{/if}
								{#each cat.conditions as cond (cond.value)}
									<label class="flex items-start space-x-2 text-sm">
										<Checkbox
											checked={conditionsOf(entry).includes(cond.value)}
											onCheckedChange={(v) => toggleCondition(cat.value, cond.value, v === true)}
											{disabled}
										/>
										<span>{cond.label}</span>
									</label>
								{/each}
								<div class="flex items-center gap-2 pt-1">
									<span class="shrink-0 text-sm text-muted-foreground">อื่นๆ (โปรดระบุ):</span>
									<Input
										value={entry.other ?? ''}
										oninput={(e) => setCategoryOther(cat.value, e.currentTarget.value)}
										{disabled}
										class="flex-1"
									/>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>
