<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import Package from '@lucide/svelte/icons/package';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import HouseholdAddressFields from './forms/household-address-fields.svelte';
	import PetQuickSelect from './forms/pet-quick-select.svelte';
	import UnifiedRegistrationMemberCard from './unified-registration-member-card.svelte';
	import {
		blankUnifiedMember,
		unifiedRegistrationInputSchema,
		type UnifiedRegistrationChannel,
		type UnifiedRegistrationInput
	} from '../domain/unified-registration';
	import type { HouseholdVehicle, PetGroup } from '../domain/people';

	let {
		channel = 'onsite',
		pending = false,
		onsubmit,
		onDirtyChange
	}: {
		channel?: UnifiedRegistrationChannel;
		pending?: boolean;
		onsubmit: (input: UnifiedRegistrationInput) => Promise<void> | void;
		onDirtyChange?: (dirty: boolean) => void;
	} = $props();

	let members = $state<UnifiedRegistrationInput['members']>([blankUnifiedMember()]);
	let household = $state<UnifiedRegistrationInput['household']>({
		housing_type: null,
		residence_landmark: null,
		address_no: '',
		village_no: '',
		subdistrict: '',
		district: '',
		province: '',
		postal_code: '',
		pets: [] as PetGroup[],
		vehicles: [] as HouseholdVehicle[],
		assets: null
	});
	let assetDescription = $state('');
	let formError = $state<string | null>(null);
	let touched = $state(false);

	$effect(() => {
		onDirtyChange?.(touched);
	});

	function markDirty() {
		touched = true;
	}

	function addMember() {
		if (pending) return;
		members = [...members, blankUnifiedMember()];
		markDirty();
	}

	function removeMember(index: number) {
		if (pending || index === 0 || members.length <= 1) return;
		members = members.filter((_, i) => i !== index);
		markDirty();
	}

	function addVehicle() {
		if (pending) return;
		household.vehicles = [...(household.vehicles ?? []), { type: 'car', license_plate: '' }];
		markDirty();
	}

	function removeVehicle(index: number) {
		if (pending) return;
		household.vehicles = (household.vehicles ?? []).filter((_, i) => i !== index);
		markDirty();
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (pending) return;

		const payload: UnifiedRegistrationInput = {
			members,
			household: {
				...household,
				assets: assetDescription.trim()
					? { description: assetDescription.trim(), image_url: null }
					: null
			}
		};

		const result = unifiedRegistrationInputSchema.safeParse(payload);
		if (!result.success) {
			const first = result.error.issues[0];
			formError = first?.message ?? 'กรุณากรอกข้อมูลให้ครบถ้วน';
			toast.error(formError);
			return;
		}

		formError = null;
		try {
			await onsubmit(result.data as UnifiedRegistrationInput);
			touched = false;
		} catch {
			// Caller surfaces save errors.
		}
	}
</script>

<form class="space-y-6" onsubmit={handleSubmit} oninput={markDirty}>
	<section class="space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
		<div class="flex items-center gap-2 border-b border-border pb-3">
			<Home class="size-5 text-primary" />
			<div>
				<h2 class="text-base font-bold text-foreground">ข้อมูลครอบครัวร่วม</h2>
				<p class="text-xs text-muted-foreground">
					ที่อยู่ ที่พัก สัตว์เลี้ยง และทรัพย์สินของทั้งครอบครัว
				</p>
			</div>
		</div>

		<HouseholdAddressFields
			bind:housing_type={household.housing_type}
			bind:residence_landmark={
				() => household.residence_landmark ?? '',
				(v) => {
					household.residence_landmark = v || null;
				}
			}
			bind:address_no={
				() => household.address_no ?? '',
				(v) => {
					household.address_no = v;
				}
			}
			bind:village_no={
				() => household.village_no ?? '',
				(v) => {
					household.village_no = v;
				}
			}
			bind:subdistrict={
				() => household.subdistrict ?? '',
				(v) => {
					household.subdistrict = v;
				}
			}
			bind:district={
				() => household.district ?? '',
				(v) => {
					household.district = v;
				}
			}
			bind:province={
				() => household.province ?? '',
				(v) => {
					household.province = v;
				}
			}
			bind:postal_code={
				() => household.postal_code ?? '',
				(v) => {
					household.postal_code = v;
				}
			}
			required={true}
			disabled={pending}
		/>

		<PetQuickSelect
			bind:pets={
				() => (household.pets as PetGroup[]) ?? [],
				(v) => {
					household.pets = v;
				}
			}
			disabled={pending}
		/>

		<div class="space-y-3 border-t border-border pt-4">
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<Package class="size-4 text-primary" />
					<h3 class="text-sm font-semibold text-foreground">ยานพาหนะและทรัพย์สิน</h3>
				</div>
				{#if !pending}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={addVehicle}
						class="h-8 gap-1 text-xs"
					>
						<Plus class="size-3.5" /> เพิ่มยานพาหนะ
					</Button>
				{/if}
			</div>

			{#if (household.vehicles ?? []).length === 0}
				<p class="text-xs text-muted-foreground">ยังไม่มียานพาหนะ</p>
			{:else}
				<div class="space-y-2">
					{#each household.vehicles ?? [] as vehicle, index (index)}
						<div
							class="flex flex-wrap items-end gap-2 rounded-lg border border-border/80 bg-muted/20 p-2.5"
						>
							<div class="w-[140px] shrink-0 space-y-1">
								<Label class="text-2xs text-muted-foreground">ประเภท</Label>
								<Select.Root
									type="single"
									value={vehicle.type}
									onValueChange={(val) => {
										if (val === 'car' || val === 'motorcycle' || val === 'other') {
											vehicle.type = val;
											household.vehicles = [...(household.vehicles ?? [])];
										}
									}}
									disabled={pending}
								>
									<Select.Trigger class="!h-8 w-full rounded-md text-xs">
										{vehicle.type === 'car'
											? 'รถยนต์'
											: vehicle.type === 'motorcycle'
												? 'รถจักรยานยนต์'
												: 'อื่นๆ'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="car" label="รถยนต์" />
										<Select.Item value="motorcycle" label="รถจักรยานยนต์" />
										<Select.Item value="other" label="อื่นๆ" />
									</Select.Content>
								</Select.Root>
							</div>
							<div class="min-w-[140px] flex-1 space-y-1">
								<Label class="text-2xs text-muted-foreground">ทะเบียนรถ</Label>
								<Input
									class="h-8"
									value={vehicle.license_plate ?? ''}
									disabled={pending}
									oninput={(e) => {
										vehicle.license_plate = (e.currentTarget as HTMLInputElement).value;
										household.vehicles = [...(household.vehicles ?? [])];
									}}
								/>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={pending}
								onclick={() => removeVehicle(index)}
								class="h-8 text-xs text-destructive"
							>
								ลบ
							</Button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="space-y-1.5">
				<Label for="family-assets" class="text-xs font-semibold text-foreground"
					>ทรัพย์สินมีค่า</Label
				>
				<Textarea
					id="family-assets"
					bind:value={assetDescription}
					disabled={pending}
					rows={2}
					placeholder="เช่น เอกสารสำคัญ เครื่องใช้ไฟฟ้า"
					class="min-h-16 text-sm"
				/>
			</div>
		</div>
	</section>

	<section class="space-y-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-2">
				<Users class="size-5 text-primary" />
				<div>
					<h2 class="text-base font-bold text-foreground">สมาชิกในครอบครัว</h2>
					<p class="text-xs text-muted-foreground">
						ทุกคนกรอกข้อมูลเท่ากัน · คนแรกคือผู้ติดต่อหลัก
						{#if channel === 'onsite'}
							· สถานะหลังบันทึก arriving
						{/if}
					</p>
				</div>
			</div>
			<Button
				type="button"
				variant="outline"
				disabled={pending}
				onclick={addMember}
				class="h-9 gap-1.5"
			>
				<Plus class="size-4" />
				เพิ่มสมาชิก
			</Button>
		</div>

		{#each [...members.keys()] as index (index)}
			<UnifiedRegistrationMemberCard
				bind:member={
					() => members[index]!,
					(v) => {
						members[index] = v;
						members = [...members];
					}
				}
				{index}
				canRemove={index > 0}
				disabled={pending}
				onRemove={() => removeMember(index)}
			/>
		{/each}
	</section>

	{#if formError}
		<p class="text-sm text-destructive" role="alert">{formError}</p>
	{/if}

	<div
		class="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 px-1 py-3 backdrop-blur-sm"
	>
		<Button
			type="submit"
			disabled={pending}
			class="h-11 w-full gap-2 text-base font-semibold sm:w-auto sm:px-8"
		>
			{#if pending}
				<Loader2 class="size-4 animate-spin" />
				กำลังบันทึก…
			{:else}
				บันทึกลงทะเบียนทั้งครอบครัว
			{/if}
		</Button>
	</div>
</form>
