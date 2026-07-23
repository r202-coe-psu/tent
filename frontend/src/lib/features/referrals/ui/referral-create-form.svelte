<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import Search from '@lucide/svelte/icons/search';
	import Loader from '@lucide/svelte/icons/loader';
	import X from '@lucide/svelte/icons/x';
	import User from '@lucide/svelte/icons/user';

	import { referralInputSchema } from '../domain/referral.schema';
	import { useCreateReferral } from '../application/queries';
	import { useSearchEvacuees, type Evacuee } from '$lib/features/people';
	import RedactionBanner from './redaction-banner.svelte';

	let { onCreated }: { onCreated: (referralId: string) => void } = $props();

	const queryClient = useQueryClient();
	const createReferralMutation = useCreateReferral(queryClient);

	// Setup Superform
	const form = superForm(
		defaults(
			{
				referral_type: 'medical-emergency',
				urgency: 'normal',
				to_org: { name: '', kind: 'hospital' }
			},
			zod4(referralInputSchema)
		),
		{
			id: 'referral-create-form',
			SPA: true,
			dataType: 'json',
			validators: zod4(referralInputSchema),
			resetForm: true,
			onUpdated: ({ form: f }) => {
				if (!f.valid) {
					if (f.errors.evacuee_id) {
						toast.error('กรุณาเลือกผู้ประสบภัย');
					} else {
						toast.error('กรุณากรอกข้อมูลบังคับให้ครบถ้วนก่อนบันทึกร่าง');
					}
				}
			},
			onUpdate: async ({ form: f }) => {
				if (!f.valid) {
					if (f.errors.evacuee_id) {
						toast.error('กรุณาเลือกผู้ประสบภัย');
					} else {
						toast.error('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง');
					}
					return;
				}
				if (!f.data.evacuee_id) {
					toast.error('กรุณาเลือกผู้ประสบภัยสำหรับทำรายการส่งต่อ');
					return;
				}

				await toast.promise(
					(async () => {
						const res = await createReferralMutation.mutateAsync(f.data);
						selectedEvacuee = null;
						searchTerm = '';
						onCreated(res._id);
					})(),
					{
						loading: 'กำลังบันทึกข้อมูลการส่งต่อ...',
						success: 'สร้างรายการส่งต่อสำเร็จ!',
						error: (err) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างรายการ')
					}
				);
			}
		}
	);

	const { form: formData, submitting, errors } = form;

	// Reset destination fields when referral_type changes
	function setReferralType(type: 'medical-emergency' | 'capacity' | 'resource') {
		$formData.referral_type = type;
		if (type === 'capacity') {
			$formData.to_org = undefined;
		} else if (type === 'resource' || type === 'medical-emergency') {
			$formData.to_shelter_code = undefined;
			if (!$formData.to_org) {
				$formData.to_org = {
					name: '',
					kind: type === 'medical-emergency' ? 'hospital' : 'social_services'
				};
			} else {
				$formData.to_org.kind = type === 'medical-emergency' ? 'hospital' : 'social_services';
			}
		}
	}

	let searchTerm = $state('');
	let debouncedTerm = $state('');
	let searchTimeout: ReturnType<typeof setTimeout>;
	let selectedEvacuee: Evacuee | null = $state(null);
	let showDropdown: boolean = $state(false);
	let searchInputRef: HTMLInputElement | null = $state(null);

	$effect(() => {
		const q = searchTerm.trim();
		clearTimeout(searchTimeout);
		if (!q) {
			debouncedTerm = '';
			return;
		}
		searchTimeout = setTimeout(() => {
			debouncedTerm = q;
		}, 300);
		return () => clearTimeout(searchTimeout);
	});

	// Lazy search query: only executes when user types at least 2 characters
	const searchResults = useSearchEvacuees(
		() => debouncedTerm,
		() => debouncedTerm.trim().length >= 2
	);

	const foundEvacuees: Evacuee[] = $derived(
		(searchResults.data ? (searchResults.data as Evacuee[]) : []) as Evacuee[]
	);
	const isSearching = $derived(searchResults.isFetching && debouncedTerm.trim().length >= 2);

	// Sync superform state when selection is updated
	$effect(() => {
		if (selectedEvacuee) {
			$formData.evacuee_id = selectedEvacuee._id;
		}
	});

	function selectEvacuee(evacuee: Evacuee) {
		selectedEvacuee = evacuee;
		searchTerm = `${evacuee.first_name} ${evacuee.last_name}`;
		showDropdown = false;
	}

	function clearSelection() {
		selectedEvacuee = null;
		searchTerm = '';
		$formData.evacuee_id = '';
		showDropdown = true;
		setTimeout(() => searchInputRef?.focus(), 0);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			showDropdown = false;
		}
	}

	// Click outside handler to dismiss dropdown
	$effect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.evacuee-search-container')) {
				showDropdown = false;
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	// Helper to check if a specific evacuee is currently selected (safe from template compiler type inference bugs)
	function isSelected(evacueeId: string): boolean {
		return selectedEvacuee ? selectedEvacuee._id === evacueeId : false;
	}
</script>

<div class="space-y-6">
	<!-- Warning Banner when Hospital destination is chosen -->
	{#if $formData.referral_type === 'medical-emergency' || $formData.to_org?.kind === 'hospital'}
		<RedactionBanner />
	{/if}

	<Card.Root class="overflow-hidden border border-border/80 shadow-md">
		<Card.Header class="bg-muted/40 pb-4">
			<Card.Title class="text-xl font-bold"
				>สร้างรายการส่งต่อผู้ประสบภัย (New Referral Request)</Card.Title
			>
			<Card.Description
				>เลือกประเภทการส่งต่อและกรอกข้อมูลปลายทางรวมถึงรายละเอียดผู้ประสบภัยที่ต้องการส่งตัว</Card.Description
			>
		</Card.Header>
		<Card.Content class="pt-6">
			<form method="POST" use:form.enhance class="space-y-6">
				<!-- Step 1: Referral Kind Selection -->
				<div class="space-y-3">
					<span class="text-sm font-semibold text-foreground"
						>1. ประเภทการส่งต่อ (Referral Kind) *</span
					>
					<Form.Field {form} name="referral_type">
						<Form.Control>
							<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
								<button
									type="button"
									onclick={() => {
										setReferralType('medical-emergency');
									}}
									class="flex cursor-pointer items-center justify-between rounded-lg border p-4 text-left transition-all hover:bg-muted/50 {$formData.referral_type ===
									'medical-emergency'
										? 'border-primary bg-primary/5 ring-2 ring-primary/20'
										: 'border-border'}"
								>
									<div class="space-y-1">
										<div class="text-sm font-semibold text-foreground">
											🏥 การรักษาพยาบาล (Medical)
										</div>
										<div class="text-xs text-muted-foreground">
											ส่งตัวผู้ป่วยฉุกเฉินเข้ารับการรักษาพยาบาล
										</div>
									</div>
									<input
										type="radio"
										name="referral_type"
										value="medical-emergency"
										checked={$formData.referral_type === 'medical-emergency'}
										class="h-4 w-4 text-primary"
									/>
								</button>

								<button
									type="button"
									onclick={() => {
										setReferralType('capacity');
									}}
									class="flex cursor-pointer items-center justify-between rounded-lg border p-4 text-left transition-all hover:bg-muted/50 {$formData.referral_type ===
									'capacity'
										? 'border-primary bg-primary/5 ring-2 ring-primary/20'
										: 'border-border'}"
								>
									<div class="space-y-1">
										<div class="text-sm font-semibold text-foreground">
											🏘️ ย้ายศูนย์พักพิง (Capacity)
										</div>
										<div class="text-xs text-muted-foreground">
											ย้ายผู้พักพิงไปศูนย์อื่นเนื่องจากศูนย์เต็ม
										</div>
									</div>
									<input
										type="radio"
										name="referral_type"
										value="capacity"
										checked={$formData.referral_type === 'capacity'}
										class="h-4 w-4 text-primary"
									/>
								</button>

								<button
									type="button"
									onclick={() => {
										setReferralType('resource');
									}}
									class="flex cursor-pointer items-center justify-between rounded-lg border p-4 text-left transition-all hover:bg-muted/50 {$formData.referral_type ===
									'resource'
										? 'border-primary bg-primary/5 ring-2 ring-primary/20'
										: 'border-border'}"
								>
									<div class="space-y-1">
										<div class="text-sm font-semibold text-foreground">
											📦 ขอสนับสนุนสิ่งของ (Resource)
										</div>
										<div class="text-xs text-muted-foreground">
											ขอสนับสนุนทรัพยากร/สิ่งของจำเป็นพิเศษ
										</div>
									</div>
									<input
										type="radio"
										name="referral_type"
										value="resource"
										checked={$formData.referral_type === 'resource'}
										class="h-4 w-4 text-primary"
									/>
								</button>
							</div>
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<hr class="border-border/60" />

				<!-- Step 2: Evacuee Selection (Lazy Search) -->
				<div class="evacuee-search-container relative space-y-2">
					<label
						for="evacuee-search"
						class="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
						>2. ค้นหาและเลือกผู้ประสบภัย *</label
					>
					<div class="relative">
						<Input
							id="evacuee-search"
							type="text"
							placeholder="พิมพ์ ชื่อ-นามสกุล, บัตรประชาชน หรือเบอร์โทร (อย่างน้อย 2 ตัวอักษร)..."
							bind:value={searchTerm}
							bind:ref={searchInputRef}
							onfocus={() => {
								showDropdown = true;
							}}
							onkeydown={handleKeyDown}
							disabled={!!selectedEvacuee}
							class="pr-9 pl-9 {$errors.evacuee_id ? 'border-destructive' : ''}"
						/>
						<div class="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
							{#if isSearching}
								<Loader class="h-4 w-4 animate-spin" />
							{:else}
								<Search class="h-4 w-4" />
							{/if}
						</div>
						{#if selectedEvacuee}
							<button
								type="button"
								class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								onclick={clearSelection}
							>
								<X class="h-4 w-4" />
							</button>
						{/if}
					</div>

					{#if $errors.evacuee_id}
						<p class="text-xs font-medium text-destructive">{$errors.evacuee_id}</p>
					{/if}

					<!-- Selected state chip -->
					{#if selectedEvacuee}
						<div
							class="mt-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"
						>
							<User class="h-3.5 w-3.5" />
							{selectedEvacuee.first_name}
							{selectedEvacuee.last_name}
							{#if selectedEvacuee.phone}
								<span class="text-xs opacity-80">({selectedEvacuee.phone})</span>
							{/if}
						</div>
					{/if}

					<!-- Autocomplete dropdown -->
					{#if showDropdown && !selectedEvacuee && debouncedTerm.trim().length >= 2}
						<div
							class="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg"
							role="listbox"
						>
							{#if searchResults.isLoading}
								<div class="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
									<Loader class="h-3.5 w-3.5 animate-spin" />
									กำลังค้นหา...
								</div>
							{:else if foundEvacuees.length > 0}
								{#each foundEvacuees as evacuee (evacuee._id)}
									<button
										type="button"
										role="option"
										aria-selected={isSelected(evacuee._id)}
										class="w-full border-b border-border/40 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent hover:text-accent-foreground"
										onclick={() => selectEvacuee(evacuee)}
									>
										<div class="font-medium text-foreground">
											{evacuee.first_name}
											{evacuee.last_name}
										</div>
										<div class="mt-0.5 text-xs text-muted-foreground">
											{#if evacuee.phone}เบอร์โทร: {evacuee.phone} ·
											{/if}
											ID: {evacuee._id}
										</div>
									</button>
								{/each}
							{:else}
								<div class="px-3 py-2 text-sm text-muted-foreground">
									ไม่พบผู้ประสบภัย "{debouncedTerm}"
								</div>
							{/if}
						</div>
					{:else if searchTerm.trim().length > 0 && searchTerm.trim().length < 2}
						<p class="px-2 py-1 text-xs text-muted-foreground">
							พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาผู้ประสบภัย
						</p>
					{/if}
				</div>

				<hr class="border-border/60" />

				<!-- Step 3: Target Destination -->
				<div class="space-y-4">
					<span class="text-sm font-semibold text-foreground">3. ข้อมูลปลายทางที่ส่งต่อ</span>

					{#if $formData.referral_type === 'capacity'}
						<Form.Field {form} name="to_shelter_code">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>รหัสศูนย์พักพิงปลายทาง (Target Shelter Code) *</Form.Label>
									<Input
										{...props}
										bind:value={$formData.to_shelter_code}
										placeholder="เช่น SH002"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					{:else}
						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							{#if $formData.to_org}
								<Form.Field {form} name="to_org.name">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label>ชื่อหน่วยงาน/สถานพยาบาล ปลายทาง *</Form.Label>
											<Input
												{...props}
												bind:value={$formData.to_org.name}
												placeholder="เช่น โรงพยาบาลมหาราช"
											/>
										{/snippet}
									</Form.Control>
									<Form.FieldErrors />
								</Form.Field>

								<Form.Field {form} name="to_org.contact">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label>ข้อมูลการติดต่อ / เบอร์โทรศัพท์</Form.Label>
											<Input
												{...props}
												bind:value={$formData.to_org.contact}
												placeholder="เช่น 053-123456"
											/>
										{/snippet}
									</Form.Control>
									<Form.FieldErrors />
								</Form.Field>
							{/if}
						</div>
					{/if}
				</div>

				<hr class="border-border/60" />

				<!-- Step 4: Referral Details -->
				<div class="space-y-4">
					<span class="text-sm font-semibold text-foreground">4. รายละเอียดความจำเป็น</span>

					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<Form.Field {form} name="urgency">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ระดับความเร่งด่วน *</Form.Label>
									<select
										{...props}
										bind:value={$formData.urgency}
										class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
									>
										<option value="normal">ปกติ (Normal)</option>
										<option value="urgent">เร่งด่วน (Urgent)</option>
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<Form.Field {form} name="reason">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เหตุผลการส่งต่อ / ความจำเป็น *</Form.Label>
								<Textarea
									{...props}
									bind:value={$formData.reason}
									placeholder="ระบุรายละเอียดเหตุผลความจำเป็นในการส่งต่อผู้ประสบภัย"
									rows={3}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name="notes">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>บันทึกข้อความเพิ่มเติม / หมายเหตุ</Form.Label>
								<Textarea
									{...props}
									bind:value={$formData.notes}
									placeholder="ระบุข้อมูลเพิ่มเติม (ถ้ามี)"
									rows={2}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="flex items-center justify-end gap-3 border-t border-border/60 pt-4">
					<Button
						type="submit"
						disabled={$submitting}
						class="w-32 bg-primary text-primary-foreground hover:bg-primary/95"
					>
						บันทึกร่าง
					</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
