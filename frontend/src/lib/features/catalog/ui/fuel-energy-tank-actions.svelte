<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		gasCylinderBalance,
		useGasLedger,
		useRefillGasCylinder,
		useUpdateFuelCylinder,
		useWriteOffGasCylinder,
		type FuelCylinder
	} from '$lib/features/kitchen';

	let { cylinder, canWrite = false }: { cylinder: FuelCylinder; canWrite?: boolean } = $props();
	const ledger = useGasLedger();
	const refill = useRefillGasCylinder();
	const writeOff = useWriteOffGasCylinder();
	const update = useUpdateFuelCylinder();

	const remaining = $derived(
		gasCylinderBalance(ledger.data ?? [], cylinder._id, cylinder.capacity_kg)
	);

	function ctx() {
		return { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'warehouse_staff' };
	}

	async function refillFull() {
		const room = Number(cylinder.capacity_kg) - Number(remaining);
		if (room <= 0 || !confirm(`เติม ${cylinder.cylinder_code} ให้เต็มถัง (${room} กก.) หรือไม่?`))
			return;
		await refill.mutateAsync({ cylinderId: cylinder._id, qtyKg: String(room), ctx: ctx() });
	}

	async function markEmpty() {
		if (!confirm(`ยืนยันบันทึก ${cylinder.cylinder_code} เป็นถังหมดหรือไม่?`)) return;
		if (Number(remaining) > 0) await writeOff.mutateAsync({ cylinderId: cylinder._id, ctx: ctx() });
	}

	async function toggleUnavailable() {
		const deactivated = !cylinder.deactivated;
		if (
			!confirm(
				deactivated
					? `ตั้ง ${cylinder.cylinder_code} เป็น “ใช้ไม่ได้” หรือไม่?`
					: `เปิดใช้งาน ${cylinder.cylinder_code} หรือไม่?`
			)
		)
			return;
		await update.mutateAsync({
			doc: cylinder,
			input: {
				item_master_id: cylinder.item_master_id,
				cylinder_code: cylinder.cylinder_code,
				name: cylinder.name,
				capacity_kg: cylinder.capacity_kg,
				burn_rate_kg_per_hour: cylinder.burn_rate_kg_per_hour,
				time_multiplier: cylinder.time_multiplier,
				tare_weight_kg: cylinder.tare_weight_kg,
				deactivated
			}
		});
	}
</script>

{#if canWrite}
	<div class="flex flex-wrap justify-center gap-1.5">
		<Button
			variant="outline"
			size="sm"
			class="min-h-10 border-sky-200 text-sky-700 hover:bg-sky-50"
			disabled={refill.isPending || Number(remaining) >= Number(cylinder.capacity_kg)}
			onclick={refillFull}>เติมแก๊ส</Button
		>
		<Button
			variant="outline"
			size="sm"
			class="min-h-10 border-amber-200 text-amber-700 hover:bg-amber-50"
			disabled={writeOff.isPending || Number(remaining) <= 0}
			onclick={markEmpty}>บันทึกถังหมด</Button
		>
		<Button
			variant="outline"
			size="sm"
			class="min-h-10 border-red-200 text-red-700 hover:bg-red-50"
			disabled={update.isPending}
			onclick={toggleUnavailable}>{cylinder.deactivated ? 'เปิดใช้งาน' : 'ตั้งใช้ไม่ได้'}</Button
		>
	</div>
{/if}
