<script lang="ts">
	import Car from '@lucide/svelte/icons/car';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, VehicleType, ParkingRule } from '../domain/schema';
	import { parkingRuleLabels } from '../domain/policy-labels';
	import { applyParkingAvailability } from '../domain/feature-flag-policy-sync';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';

	let {
		formData,
		disabled = false
	}: {
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	const vehicleTypes: { value: VehicleType; label: string; unit: string }[] = [
		{ value: 'motorcycle', label: 'รถจักรยานยนต์ (Motorcycles)', unit: 'คัน' },
		{ value: 'car', label: 'รถยนต์ / รถกระบะ (Cars / Pickups)', unit: 'คัน' },
		{ value: 'truck', label: 'รถบรรทุก / รถขนาดใหญ่ (Trucks / Heavy Vehicles)', unit: 'คัน' },
		{ value: 'boat', label: 'เรืออพยพ / เรือเล็ก (Boats)', unit: 'ลำ' }
	];

	const parkingRules: { value: ParkingRule; label: string }[] = Object.entries(
		parkingRuleLabels
	).map(([value, label]) => ({ value: value as ParkingRule, label }));

	function ensurePolicy() {
		if (!$formData.parking_policy) {
			$formData.parking_policy = {
				availability: null,
				supported_vehicles: [],
				rules: [],
				rules_other: null
			};
		}
	}

	function setAvailability(value: 'none' | 'available') {
		const next = applyParkingAvailability($formData, value);
		$formData.feature_flags = next.feature_flags;
		$formData.parking_policy = next.parking_policy;
	}

	function vehicleEntry(type: VehicleType) {
		return $formData.parking_policy?.supported_vehicles?.find((v) => v.type === type);
	}

	function toggleVehicle(type: VehicleType, checked: boolean) {
		ensurePolicy();
		const cur = $formData.parking_policy!.supported_vehicles ?? [];
		$formData.parking_policy!.supported_vehicles = checked
			? [...cur, { type, max_capacity: null }]
			: cur.filter((v) => v.type !== type);
	}

	function setVehicleCapacity(type: VehicleType, raw: string) {
		ensurePolicy();
		$formData.parking_policy!.supported_vehicles = (
			$formData.parking_policy!.supported_vehicles ?? []
		).map((v) => (v.type === type ? { ...v, max_capacity: raw === '' ? null : Number(raw) } : v));
	}

	function toggleRule(rule: ParkingRule, checked: boolean) {
		ensurePolicy();
		const cur = $formData.parking_policy!.rules ?? [];
		$formData.parking_policy!.rules = checked
			? [...new Set([...cur, rule])]
			: cur.filter((r) => r !== rule);
	}

	const availability = $derived($formData.parking_policy?.availability ?? null);
</script>

<section
	id="parking-policy"
	class="shelter-form-scroll-mt mb-6 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs transition-shadow hover:shadow-sm sm:p-8"
>
	<div class="flex items-center gap-3 border-b border-slate-100 pb-4">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647]/5 text-[#0A2647]"
		>
			<Car class="h-5 w-5" />
		</div>
		<div>
			<div class="flex items-center gap-2">
				<span class="text-xs font-bold tracking-wider text-[#0284C7] uppercase">ส่วนที่ 9</span>
			</div>
			<h2 class="text-base font-bold text-[#0A2647] sm:text-lg">
				นโยบายยานพาหนะและการจอดรถ (Vehicle &amp; Parking Policy)
			</h2>
		</div>
	</div>

	<!-- 8.1 Master parking policy -->
	<div class="space-y-3">
		<h3 class="text-sm font-bold text-slate-800">
			1. นโยบายหลักพื้นที่จอดรถ (Master Parking Policy)
		</h3>
		<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
			<label class="flex cursor-pointer items-center space-x-3 text-sm font-medium text-slate-800">
				<input
					type="radio"
					name="parking-availability"
					value="none"
					checked={availability === 'none'}
					onchange={() => setAvailability('none')}
					{disabled}
					class="h-4 w-4 accent-[#0A2647]"
				/>
				<span>ไม่มีพื้นที่จอดรถ (No Parking Available)</span>
			</label>
			<label class="flex cursor-pointer items-center space-x-3 text-sm font-medium text-slate-800">
				<input
					type="radio"
					name="parking-availability"
					value="available"
					checked={availability === 'available'}
					onchange={() => setAvailability('available')}
					{disabled}
					class="h-4 w-4 accent-[#0A2647]"
				/>
				<span>มีพื้นที่จอดรถ (Parking Available)</span>
			</label>
		</div>
	</div>

	{#if availability === 'available'}
		<!-- 8.2 Supported vehicles -->
		<div class="space-y-3">
			<h3 class="text-sm font-bold text-slate-800">
				2. ประเภทรถที่รองรับและจำนวน (Supported Vehicles &amp; Capacity)
			</h3>
			<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
				{#each vehicleTypes as vt (vt.value)}
					{@const entry = vehicleEntry(vt.value)}
					<div class="space-y-2">
						<label
							class="flex cursor-pointer items-center space-x-3 text-sm font-medium text-slate-800"
						>
							<Checkbox
								checked={!!entry}
								onCheckedChange={(v) => toggleVehicle(vt.value, v === true)}
								{disabled}
							/>
							<span>{vt.label}</span>
						</label>
						{#if entry}
							<div class="flex items-center gap-2 pl-7 text-sm">
								<span class="text-slate-500">รองรับสูงสุด:</span>
								<Input
									type="number"
									min="0"
									value={entry.max_capacity ?? ''}
									oninput={(e) => setVehicleCapacity(vt.value, e.currentTarget.value)}
									{disabled}
									class="w-28 bg-white"
									placeholder="0"
								/>
								<span class="text-slate-500">{vt.unit}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- 8.3 Parking rules -->
		<div class="space-y-3">
			<h3 class="text-sm font-bold text-slate-800">
				3. เงื่อนไขและกฎการจอดรถ (Parking Rules &amp; Disclaimers)
			</h3>
			<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
				{#each parkingRules as rule (rule.value)}
					<label
						class="flex cursor-pointer items-start space-x-3 text-sm font-medium text-slate-800"
					>
						<Checkbox
							checked={($formData.parking_policy?.rules ?? []).includes(rule.value)}
							onCheckedChange={(v) => toggleRule(rule.value, v === true)}
							{disabled}
						/>
						<span>{rule.label}</span>
					</label>
				{/each}
				<div class="flex items-center gap-2 pt-1">
					<span class="shrink-0 text-sm font-medium text-slate-600">อื่นๆ (โปรดระบุ):</span>
					<Input
						value={$formData.parking_policy?.rules_other ?? ''}
						oninput={(e) => {
							ensurePolicy();
							$formData.parking_policy!.rules_other = e.currentTarget.value || null;
						}}
						{disabled}
						class="flex-1 bg-white"
					/>
				</div>
			</div>
		</div>
	{/if}
</section>
