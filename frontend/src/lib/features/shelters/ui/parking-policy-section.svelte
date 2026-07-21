<script lang="ts">
	import Car from '@lucide/svelte/icons/car';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, VehicleType, ParkingRule } from '../domain/schema';
	import { parkingRuleLabels } from '../domain/policy-labels';
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
		ensurePolicy();
		if (value === 'none') {
			// FR-23-30 / D-A5 — clear sub-fields when parking is unavailable.
			$formData.parking_policy = {
				availability: 'none',
				supported_vehicles: [],
				rules: [],
				rules_other: null
			};
		} else {
			$formData.parking_policy!.availability = 'available';
		}
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

<section class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border p-6">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<Car class="h-5 w-5 text-shelter-blue-text" />
		<span class="text-sm font-bold text-black">8.</span>
		<h2 class="text-base font-bold text-black">
			นโยบายยานพาหนะและการจอดรถ (Vehicle &amp; Parking Policy)
		</h2>
	</div>

	<!-- 8.1 Master parking policy -->
	<div class="space-y-3">
		<h3 class="text-sm font-bold text-card-foreground">
			1. นโยบายหลักพื้นที่จอดรถ (Master Parking Policy)
		</h3>
		<div class="space-y-2 rounded-lg border border-shelter-border bg-background p-3">
			<label class="flex items-center space-x-3 text-sm">
				<input
					type="radio"
					name="parking-availability"
					value="none"
					checked={availability === 'none'}
					onchange={() => setAvailability('none')}
					{disabled}
					class="h-4 w-4 accent-shelter-blue-text"
				/>
				<span>ไม่มีพื้นที่จอดรถ (No Parking Available)</span>
			</label>
			<label class="flex items-center space-x-3 text-sm">
				<input
					type="radio"
					name="parking-availability"
					value="available"
					checked={availability === 'available'}
					onchange={() => setAvailability('available')}
					{disabled}
					class="h-4 w-4 accent-shelter-blue-text"
				/>
				<span>มีพื้นที่จอดรถ (Parking Available)</span>
			</label>
		</div>
	</div>

	{#if availability === 'available'}
		<!-- 8.2 Supported vehicles -->
		<div class="space-y-3">
			<h3 class="text-sm font-bold text-card-foreground">
				2. ประเภทรถที่รองรับและจำนวน (Supported Vehicles &amp; Capacity)
			</h3>
			<div class="space-y-3 rounded-lg border border-shelter-border bg-background p-3">
				{#each vehicleTypes as vt (vt.value)}
					{@const entry = vehicleEntry(vt.value)}
					<div class="space-y-2">
						<label class="flex items-center space-x-3 text-sm">
							<Checkbox
								checked={!!entry}
								onCheckedChange={(v) => toggleVehicle(vt.value, v === true)}
								{disabled}
							/>
							<span>{vt.label}</span>
						</label>
						{#if entry}
							<div class="flex items-center gap-2 pl-7 text-sm">
								<span class="text-muted-foreground">รองรับสูงสุด:</span>
								<Input
									type="number"
									min="0"
									value={entry.max_capacity ?? ''}
									oninput={(e) => setVehicleCapacity(vt.value, e.currentTarget.value)}
									{disabled}
									class="w-28"
									placeholder="0"
								/>
								<span class="text-muted-foreground">{vt.unit}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- 8.3 Parking rules -->
		<div class="space-y-3">
			<h3 class="text-sm font-bold text-card-foreground">
				3. เงื่อนไขและกฎการจอดรถ (Parking Rules &amp; Disclaimers)
			</h3>
			<div class="space-y-2 rounded-lg border border-shelter-border bg-background p-3">
				{#each parkingRules as rule (rule.value)}
					<label class="flex items-start space-x-2 text-sm">
						<Checkbox
							checked={($formData.parking_policy?.rules ?? []).includes(rule.value)}
							onCheckedChange={(v) => toggleRule(rule.value, v === true)}
							{disabled}
						/>
						<span>{rule.label}</span>
					</label>
				{/each}
				<div class="flex items-center gap-2 pt-1">
					<span class="shrink-0 text-sm text-muted-foreground">อื่นๆ (โปรดระบุ):</span>
					<Input
						value={$formData.parking_policy?.rules_other ?? ''}
						oninput={(e) => {
							ensurePolicy();
							$formData.parking_policy!.rules_other = e.currentTarget.value || null;
						}}
						{disabled}
						class="flex-1"
					/>
				</div>
			</div>
		</div>
	{/if}
</section>
