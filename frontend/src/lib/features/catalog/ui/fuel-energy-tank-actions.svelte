<script lang="ts">
	import Flame from '@lucide/svelte/icons/flame';
	import PackageX from '@lucide/svelte/icons/package-x';
	import CircleSlash from '@lucide/svelte/icons/circle-slash';
	import PlayCircle from '@lucide/svelte/icons/play-circle';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
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

	type PendingAction = 'refill' | 'markEmpty' | 'toggle' | null;
	let pendingAction = $state<PendingAction>(null);

	const willDeactivate = $derived(!cylinder.deactivated);
	const refillRoom = $derived(Number(cylinder.capacity_kg) - Number(remaining));

	const confirmMeta = $derived.by(() => {
		switch (pendingAction) {
			case 'refill':
				return {
					title: 'เติมแก๊สให้เต็มถัง',
					description: `เติม ${cylinder.cylinder_code} ให้เต็มถัง (${refillRoom} กก.) หรือไม่?`,
					actionLabel: 'เติมแก๊ส',
					destructive: false
				};
			case 'markEmpty':
				return {
					title: 'บันทึกถังหมด',
					description: `ยืนยันบันทึก ${cylinder.cylinder_code} เป็นถังหมดหรือไม่?`,
					actionLabel: 'บันทึกถังหมด',
					destructive: true
				};
			case 'toggle':
				return willDeactivate
					? {
							title: 'ตั้งถังเป็นใช้ไม่ได้',
							description: `ตั้ง ${cylinder.cylinder_code} เป็น "ใช้ไม่ได้" หรือไม่?`,
							actionLabel: 'ตั้งใช้ไม่ได้',
							destructive: true
						}
					: {
							title: 'เปิดใช้งานถัง',
							description: `เปิดใช้งาน ${cylinder.cylinder_code} หรือไม่?`,
							actionLabel: 'เปิดใช้งาน',
							destructive: false
						};
			default:
				return null;
		}
	});

	function askRefillFull() {
		if (refillRoom <= 0) return;
		pendingAction = 'refill';
	}

	function askMarkEmpty() {
		pendingAction = 'markEmpty';
	}

	function askToggleUnavailable() {
		pendingAction = 'toggle';
	}

	async function runPendingAction() {
		if (pendingAction === 'refill') {
			await refill.mutateAsync({ cylinderId: cylinder._id, qtyKg: String(refillRoom), ctx: ctx() });
		} else if (pendingAction === 'markEmpty') {
			if (Number(remaining) > 0) {
				await writeOff.mutateAsync({ cylinderId: cylinder._id, ctx: ctx() });
			}
		} else if (pendingAction === 'toggle') {
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
					deactivated: willDeactivate
				}
			});
		}
		pendingAction = null;
	}
</script>

{#if canWrite}
	<div class="flex flex-nowrap items-center justify-center gap-1.5">
		<Button
			variant="outline"
			size="sm"
			class="min-h-10 shrink-0 gap-1.5"
			disabled={refill.isPending || Number(remaining) >= Number(cylinder.capacity_kg)}
			onclick={askRefillFull}><Flame class="h-3.5 w-3.5" />เติมแก๊ส</Button
		>
		<Button
			variant="outline"
			size="sm"
			class="min-h-10 shrink-0 gap-1.5"
			disabled={writeOff.isPending || Number(remaining) <= 0}
			onclick={askMarkEmpty}><PackageX class="h-3.5 w-3.5" />ถังหมด</Button
		>
		<Button
			variant={cylinder.deactivated ? 'outline' : 'destructive'}
			size="sm"
			class="min-h-10 shrink-0 gap-1.5"
			disabled={update.isPending}
			onclick={askToggleUnavailable}
			>{#if cylinder.deactivated}<PlayCircle class="h-3.5 w-3.5" />เปิดใช้งาน{:else}<CircleSlash
					class="h-3.5 w-3.5"
				/>ใช้ไม่ได้{/if}</Button
		>
	</div>
{/if}

<AlertDialog.Root
	open={pendingAction !== null}
	onOpenChange={(open) => !open && (pendingAction = null)}
>
	<AlertDialog.Content>
		{#if confirmMeta}
			<AlertDialog.Header>
				<AlertDialog.Title>{confirmMeta.title}</AlertDialog.Title>
				<AlertDialog.Description>{confirmMeta.description}</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel onclick={() => (pendingAction = null)}>ยกเลิก</AlertDialog.Cancel>
				<AlertDialog.Action
					class={confirmMeta.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
					disabled={refill.isPending || writeOff.isPending || update.isPending}
					onclick={(e) => {
						e.preventDefault();
						runPendingAction();
					}}
				>
					{confirmMeta.actionLabel}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		{/if}
	</AlertDialog.Content>
</AlertDialog.Root>
