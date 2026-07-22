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
	import Check from '@lucide/svelte/icons/check';

	import { referralInputSchema } from '../domain/referral.schema';
	import { useCreateReferral } from '../application/queries';
	import { useSearchEvacuees } from '$lib/features/people';
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
				to_org: { kind: 'hospital' }
			},
			zod4(referralInputSchema)
		),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4(referralInputSchema),
			resetForm: true,
			onUpdate: async ({ form: f }) => {
				if (!f.valid) {
					toast.error('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง');
					return;
				}
				if (!f.data.evacuee_id) {
					toast.error('กรุณาเลือกผู้ประสบภัยสำหรับทำรายการส่งต่อ');
					return;
				}
				if (f.data.referral_type === 'capacity' && !f.data.to_shelter_code) {
					toast.error('กรุณาระบุรหัสศูนย์พักพิงปลายทางสำหรับการย้ายศูนย์');
					return;
				}

				await toast.promise(
					(async () => {
						const res = await createReferralMutation.mutateAsync(f.data);
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

	// Evacuee search and selection state
	let searchQuery = $state('');
	let debouncedSearchQuery = $state('');
	let searchTimeout: ReturnType<typeof setTimeout>;
	let selectedEvacueeName = $state('');

	$effect(() => {
		const q = searchQuery.trim();
		clearTimeout(searchTimeout);
		if (!q) {
			debouncedSearchQuery = '';
			return;
		}
		searchTimeout = setTimeout(() => {
			debouncedSearchQuery = q;
		}, 300);
		return () => clearTimeout(searchTimeout);
	});

	const searchResults = useSearchEvacuees(
		() => debouncedSearchQuery,
		() => !!debouncedSearchQuery
	);

	const foundEvacuees = $derived(searchResults.data ?? []);
	const isSearching = $derived(searchResults.isFetching && !!debouncedSearchQuery);

	function selectEvacuee(id: string, name: string) {
		$formData.evacuee_id = id;
		selectedEvacueeName = name;
		searchQuery = '';
		debouncedSearchQuery = '';
	}

	function clearSelectedEvacuee() {
		$formData.evacuee_id = '';
		selectedEvacueeName = '';
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
							{#snippet children({ props })}
								<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
									<label
										class="flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-all hover:bg-muted/50 {$formData.referral_type ===
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
											{...props}
											type="radio"
											name="referral_type"
											value="medical-emergency"
											bind:group={$formData.referral_type}
											class="h-4 w-4 text-primary"
										/>
									</label>

									<label
										class="flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-all hover:bg-muted/50 {$formData.referral_type ===
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
											{...props}
											type="radio"
											name="referral_type"
											value="capacity"
											bind:group={$formData.referral_type}
											class="h-4 w-4 text-primary"
										/>
									</label>

									<label
										class="flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-all hover:bg-muted/50 {$formData.referral_type ===
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
											{...props}
											type="radio"
											name="referral_type"
											value="resource"
											bind:group={$formData.referral_type}
											class="h-4 w-4 text-primary"
										/>
									</label>
								</div>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<hr class="border-border/60" />

				<!-- Step 2: Evacuee Selection -->
				<div class="space-y-2">
					<span class="text-sm font-semibold text-foreground">2. ค้นหาและเลือกผู้ประสบภัย *</span>

					{#if $formData.evacuee_id}
						<div
							class="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/30 dark:bg-emerald-950/20"
						>
							<div class="flex items-center gap-2">
								<Check class="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
								<div>
									<p class="text-sm font-medium text-emerald-900 dark:text-emerald-300">
										{selectedEvacueeName}
									</p>
									<p class="text-xs text-emerald-700 dark:text-emerald-400/80">
										ID: {$formData.evacuee_id}
									</p>
								</div>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onclick={clearSelectedEvacuee}
								class="text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
							>
								เปลี่ยน
							</Button>
						</div>
					{:else}
						<div class="space-y-3">
							<div class="relative">
								{#if isSearching}
									<Loader
										class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
									/>
								{:else}
									<Search
										class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
									/>
								{/if}
								<Input
									type="text"
									placeholder="พิมพ์ ชื่อ-นามสกุล, บัตรประชาชน หรือเบอร์โทร เพื่อค้นหาผู้ประสบภัย..."
									bind:value={searchQuery}
									class="pl-9"
								/>
							</div>

							{#if foundEvacuees.length > 0}
								<div
									class="max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-sm"
								>
									{#each foundEvacuees as person (person._id)}
										<button
											type="button"
											onclick={() =>
												selectEvacuee(person._id, `${person.first_name} ${person.last_name}`)}
											class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
										>
											<div>
												<span class="font-medium">{person.first_name} {person.last_name}</span>
												{#if person.phone}
													<span class="ml-2 text-xs text-muted-foreground">({person.phone})</span>
												{/if}
											</div>
											<span class="text-xs font-semibold text-primary">เลือก</span>
										</button>
									{/each}
								</div>
							{:else if debouncedSearchQuery && !isSearching}
								<p class="px-2 py-1 text-xs text-muted-foreground">
									ไม่พบรายชื่อผู้ประสบภัยที่ตรงกับคำค้นหา
								</p>
							{/if}
						</div>
					{/if}

					{#if $errors.evacuee_id}
						<p class="text-xs font-medium text-destructive">{$errors.evacuee_id}</p>
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
						<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
							<Form.Field {form} name="to_org.kind">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>ประเภทหน่วยงาน *</Form.Label>
										<select
											{...props}
											bind:value={$formData.to_org!.kind}
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
										>
											<option value="hospital">สถานพยาบาล / โรงพยาบาล</option>
											<option value="social_services">หน่วยงานสังคมสงเคราะห์ / พัฒนาสังคม</option>
											<option value="other">อื่น ๆ</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>

							<Form.Field {form} name="to_org.name">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>ชื่อหน่วยงานปลายทาง *</Form.Label>
										<Input
											{...props}
											bind:value={$formData.to_org!.name}
											placeholder="ระบุชื่อหน่วยงาน/สถานที่"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>

							<Form.Field {form} name="to_org.contact">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>เบอร์โทรติดต่อ (ถ้ามี)</Form.Label>
										<Input
											{...props}
											bind:value={$formData.to_org!.contact}
											placeholder="เบอร์โทรศัพท์ติดต่อ"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
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
					<Form.Button
						disabled={$submitting}
						class="w-32 bg-primary text-primary-foreground hover:bg-primary/95"
					>
						บันทึกร่าง
					</Form.Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
