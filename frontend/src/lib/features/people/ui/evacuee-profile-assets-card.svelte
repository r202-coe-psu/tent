<script lang="ts">
	import Car from '@lucide/svelte/icons/car';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Package from '@lucide/svelte/icons/package';
	import Check from '@lucide/svelte/icons/check';
	import type { Household } from '$lib/features/people';
	import EvacueePhoto from './evacuee-photo.svelte';

	let {
		household,
		readonly,
		onOpenAssetModal
	}: {
		household: Household | null;
		readonly: boolean;
		onOpenAssetModal: () => void;
	} = $props();

	const vehicles = $derived(household?.vehicles ?? []);
	const pets = $derived(household?.pets ?? []);
	const valuables = $derived(household?.assets?.description?.trim() || null);

	const vehicleLabel = (type: 'car' | 'motorcycle' | 'other') =>
		type === 'car' ? 'รถยนต์' : type === 'motorcycle' ? 'จักรยานยนต์' : 'อื่นๆ';

	const speciesLabel = (species: string) =>
		species === 'dog' ? 'สุนัข' : species === 'cat' ? 'แมว' : 'อื่นๆ';

	/** Absolute/preview URLs only — CouchDB image IDs are handled via EvacueePhoto. */
	function petPreviewSrc(imageUrl: string | null | undefined): string | null {
		const value = imageUrl?.trim();
		if (!value) return null;
		if (value.startsWith('http') || value.startsWith('blob:') || value.startsWith('data:')) {
			return value;
		}
		return null;
	}
</script>

<section class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
	<div class="flex items-center justify-between border-b border-slate-200/80 pb-2">
		<div class="flex items-center gap-2.5">
			<Car class="size-4.5 text-[#0A2647]" />
			<h3 class="text-base font-bold text-slate-900">สิ่งที่นำมาด้วย</h3>
		</div>
		{#if household && !readonly}
			<button
				type="button"
				aria-label="แก้ไขทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง"
				title="แก้ไขทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง"
				onclick={onOpenAssetModal}
				class="inline-flex size-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
			>
				<Pencil class="size-4" />
			</button>
		{/if}
	</div>

	{#if !household}
		<p class="py-4 text-center text-sm text-slate-500 italic">
			ยังไม่มีข้อมูลครัวเรือนสำหรับแสดงทรัพย์สิน
		</p>
	{:else}
		<div class="space-y-5">
			<!-- Vehicles -->
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<Car class="size-4 text-slate-500" />
					<span class="text-sm font-bold text-slate-900">ยานพาหนะ</span>
					{#if vehicles.length > 0}
						<span
							class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular-nums"
						>
							{vehicles.length}
						</span>
					{/if}
				</div>
				{#if vehicles.length > 0}
					<div class="space-y-2">
						{#each vehicles as vehicle, i (`${vehicle.type}-${vehicle.license_plate ?? ''}-${i}`)}
							<div
								class="flex flex-col gap-1 rounded-xl border border-slate-200/80 bg-slate-50 p-3"
							>
								<span class="text-sm font-bold text-slate-900">
									<Car class="mr-1 inline size-3.5 text-slate-500" />{vehicleLabel(vehicle.type)}
								</span>
								{#if vehicle.license_plate}
									<span class="text-sm font-medium text-slate-700 tabular-nums">
										ทะเบียน: {vehicle.license_plate}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500 italic"
					>
						ไม่มียานพาหนะที่นำมาด้วย
					</div>
				{/if}
			</div>

			<!-- Pets -->
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<PawPrint class="size-4 text-slate-500" />
					<span class="text-sm font-bold text-slate-900">สัตว์เลี้ยง</span>
				</div>

				{#if pets.length > 0}
					<div class="space-y-2">
						{#each pets as pet, i (`${pet.species}-${i}`)}
							{@const previewSrc = petPreviewSrc(pet.image_url)}
							{@const photoId = previewSrc ? null : pet.image_url?.trim() || null}
							<div class="flex gap-3 rounded-xl border border-slate-200/80 bg-slate-50 p-3">
								{#if previewSrc}
									<img
										src={previewSrc}
										alt={speciesLabel(pet.species)}
										class="h-16 w-16 shrink-0 rounded-lg border border-slate-200 object-cover"
									/>
								{:else if photoId}
									<EvacueePhoto
										{photoId}
										alt={speciesLabel(pet.species)}
										size="md"
										class="rounded-lg border-slate-200"
									/>
								{:else}
									<div
										class="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100"
									>
										<PawPrint class="size-6 text-slate-500" />
									</div>
								{/if}
								<div class="min-w-0 flex-1 space-y-1">
									<span class="text-sm font-bold text-slate-900">
										{speciesLabel(pet.species)}
									</span>
									{#if pet.has_cage}
										<span
											class="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800"
										>
											<Check class="size-3.5" /> มีกรง
										</span>
									{/if}
									{#if pet.notes}
										<p class="break-words text-sm text-slate-700">{pet.notes}</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500 italic"
					>
						ไม่มีสัตว์เลี้ยงที่นำมาด้วย
					</div>
				{/if}
			</div>

			<!-- Valuables -->
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<Package class="size-4 text-slate-500" />
					<span class="text-sm font-bold text-slate-900">สัมภาระ / สิ่งของมีค่า</span>
				</div>
				{#if valuables}
					<div
						class="break-words rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-sm font-medium text-slate-800"
					>
						{valuables}
					</div>
				{:else}
					<div
						class="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500 italic"
					>
						ไม่มีสัมภาระหรือสิ่งของมีค่าที่บันทึกไว้
					</div>
				{/if}
			</div>
		</div>
	{/if}
</section>
