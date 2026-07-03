<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { PetGroup } from '../domain/people';

	let {
		form,
		petsList = $bindable([])
	}: {
		form: SuperForm<any>;
		petsList: PetGroup[];
	} = $props();

	function addPetRow() {
		petsList = [...petsList, { species: 'dog', count: 1, notes: '', has_cage: false }];
	}

	function removePetRow(index: number) {
		petsList = petsList.filter((_, i) => i !== index);
	}
</script>

<Form.Field {form} name="pets">
	<Form.Control>
		{#snippet children({ props })}
			<div {...props} class="space-y-4">
				<div class="flex items-center justify-between border-b border-border/50 pb-2">
					<Form.Label class="text-base font-bold text-slate-800 dark:text-slate-200">
						สัตว์เลี้ยงที่นำมาด้วย
					</Form.Label>
					<button
						type="button"
						onclick={addPetRow}
						class="inline-flex cursor-pointer items-center gap-1 text-sm font-bold text-primary hover:underline"
					>
						<Plus class="size-4" />
						<span>เพิ่มชนิดสัตว์เลี้ยง</span>
					</button>
				</div>

				{#if petsList.length === 0}
					<div
						class="rounded-xl border border-dashed border-border bg-muted/10 py-6 text-center text-xs text-muted-foreground italic"
					>
						ไม่มีสัตว์เลี้ยงที่ลงทะเบียนไว้
					</div>
				{:else}
					<div class="space-y-3">
						{#each petsList as pet, i (i)}
							<div
								class="grid grid-cols-12 items-end gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900"
							>
								<!-- Species -->
								<div class="col-span-12 space-y-1.5 font-medium sm:col-span-3">
									<Label for="pet_species_{i}" class="text-xs font-semibold text-muted-foreground"
										>ชนิดสัตว์</Label
									>
									<Select.Root type="single" bind:value={pet.species}>
										<Select.Trigger id="pet_species_{i}" class="h-10 w-full bg-background text-sm">
											{{ dog: '🐶 สุนัข', cat: '🐱 แมว', bird: '🐦 นก', other: '🐾 อื่นๆ' }[
												pet.species
											] ?? '— เลือก —'}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="dog" label="🐶 สุนัข" />
											<Select.Item value="cat" label="🐱 แมว" />
											<Select.Item value="bird" label="🐦 นก" />
											<Select.Item value="other" label="🐾 อื่นๆ" />
										</Select.Content>
									</Select.Root>
								</div>

								<!-- Count -->
								<div class="col-span-6 space-y-1.5 font-medium sm:col-span-2">
									<Label for="pet_count_{i}" class="text-xs font-semibold text-muted-foreground"
										>จำนวน (ตัว)</Label
									>
									<Input
										id="pet_count_{i}"
										type="number"
										min={1}
										class="h-10 bg-background text-center text-sm"
										bind:value={pet.count}
									/>
								</div>

								<!-- Notes -->
								<div class="col-span-6 space-y-1.5 font-normal sm:col-span-3">
									<Label for="pet_notes_{i}" class="text-xs font-semibold text-muted-foreground"
										>หมายเหตุ</Label
									>
									<Input
										id="pet_notes_{i}"
										type="text"
										class="h-10 bg-background text-sm"
										bind:value={pet.notes}
										placeholder="หมายเหตุ"
									/>
								</div>

								<!-- Has Cage Checkbox -->
								<div class="col-span-8 flex h-10 items-center gap-2 sm:col-span-3">
									<Checkbox
										id="pet_cage_{i}"
										checked={pet.has_cage ?? false}
										onCheckedChange={(v) => (pet.has_cage = !!v)}
									/>
									<Label
										for="pet_cage_{i}"
										class="cursor-pointer text-sm font-semibold text-muted-foreground">มีกรง</Label
									>
								</div>

								<!-- Delete Button -->
								<div class="col-span-4 flex h-10 items-center justify-end sm:col-span-1">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onclick={() => removePetRow(i)}
										class="h-10 w-10 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
									>
										<X class="size-5" />
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
