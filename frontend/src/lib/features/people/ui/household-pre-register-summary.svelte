<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useCreateEvacuee, useEvacuees } from '../application/queries';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		SPECIAL_NEED_CHIPS,
		maskNationalId,
		type Evacuee,
		type Household,
		type SpecialNeed,
		type Gender,
		type Religion,
		type CardType
	} from '../domain/people';
	import { toast } from 'svelte-sonner';
	import QRCode from 'qrcode';
	import CreditCard from '@lucide/svelte/icons/credit-card';

	function handlePullMemberIdCard() {
		// Mock UI only for now
	}

	import Plus from '@lucide/svelte/icons/plus';
	import Printer from '@lucide/svelte/icons/printer';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { COUNTRIES } from '$lib/utils/country';

	let {
		createdHousehold,
		createdHead
	}: {
		createdHousehold: Household;
		createdHead: Evacuee | null;
	} = $props();

	// --- Queries and Mutations ---
	const createEvacueeMutation = useCreateEvacuee();
	const allEvacueesQuery = useEvacuees();

	let qrUrl = $state<string | null>(null);
	let isSubmitting = $state(false);

	// --- Form State (Subsequent Members) ---
	let showAddMemberForm = $state(false);
	let memberFirstName = $state('');
	let memberLastName = $state('');
	let memberNickname = $state('');
	let memberGender = $state<Gender>('male');
	let memberBirthYear = $state('');
	let memberAge = $state('');
	let memberCardType = $state<CardType>('national_id');
	let memberCardNumber = $state('');
	let memberCountry = $state('THAILAND');
	let memberReligion = $state<Religion>('buddhist');
	let memberPhone = $state('');
	let memberSpecialNeeds = new SvelteSet<SpecialNeed>();
	let memberMedicalConditions = $state('');
	let memberMedicalAllergies = $state('');
	let memberMedicalMedications = $state('');
	let memberMedicalNote = $state('');

	// Sync birth year and age two-way
	let prevMemberBirthYear = '';
	let prevMemberAge = '';
	$effect(() => {
		const by = memberBirthYear;
		const age = memberAge;
		if (by !== prevMemberBirthYear) {
			prevMemberBirthYear = by;
			if (by && by.length === 4 && !isNaN(Number(by))) {
				const computed = String(new Date().getFullYear() + 543 - Number(by));
				if (memberAge !== computed) {
					memberAge = computed;
					prevMemberAge = computed;
				}
			} else if (!by) {
				memberAge = '';
				prevMemberAge = '';
			}
		} else if (age !== prevMemberAge) {
			prevMemberAge = age;
			if (age && !isNaN(Number(age))) {
				const computed = String(new Date().getFullYear() + 543 - Number(age));
				if (memberBirthYear !== computed) {
					memberBirthYear = computed;
					prevMemberBirthYear = computed;
				}
			} else if (!age) {
				memberBirthYear = '';
				prevMemberBirthYear = '';
			}
		}
	});

	// Get household members dynamically
	const householdMembers = $derived(
		(allEvacueesQuery.data ?? []).filter((e) => e.household_id === createdHousehold?._id)
	);

	// Generate QR URL once Household is created
	$effect(() => {
		if (createdHousehold) {
			QRCode.toDataURL(createdHousehold._id, {
				width: 160,
				margin: 1,
				color: { dark: '#0f172a', light: '#ffffff' }
			}).then((url) => {
				qrUrl = url;
			});
		}
	});

	function toggleSpecialNeed(set: SvelteSet<SpecialNeed>, need: SpecialNeed) {
		if (set.has(need)) {
			set.delete(need);
		} else {
			set.add(need);
		}
	}

	async function handleAddMember() {
		if (!memberFirstName.trim() || !memberLastName.trim()) {
			toast.error('กรุณากรอกชื่อและนามสกุลของสมาชิก');
			return;
		}

		isSubmitting = true;

		try {
			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'staff'
			};

			const parsedPhone = memberPhone.trim() ? memberPhone.trim().replace(/\D/g, '') : null;

			const memberInput = {
				first_name: memberFirstName.trim(),
				last_name: memberLastName.trim(),
				gender: memberGender,
				phone: parsedPhone,
				nickname: memberNickname.trim() || undefined,
				birth_year: memberBirthYear ? Number(memberBirthYear) : undefined,
				person_id: {
					cardType: memberCardType,
					number: memberCardNumber.trim() || undefined
				},
				country: memberCountry,
				religion: memberReligion,
				special_needs: Array.from(memberSpecialNeeds),
				registered_via: 'app' as const,
				household_id: createdHousehold._id,
				medical_conditions: memberMedicalConditions
					? memberMedicalConditions
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					: [],
				medical_allergies: memberMedicalAllergies
					? memberMedicalAllergies
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					: [],
				medical_medications: memberMedicalMedications
					? memberMedicalMedications
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					: [],
				medical_note: memberMedicalNote.trim() || undefined
			};

			await createEvacueeMutation.mutateAsync({
				input: memberInput,
				ctx
			});

			toast.success(`ลงทะเบียนสมาชิก "${memberFirstName} ${memberLastName}" เรียบร้อยแล้ว`);

			// Reset member form
			memberFirstName = '';
			memberLastName = '';
			memberNickname = '';
			memberGender = 'male';
			memberBirthYear = '';
			memberAge = '';
			memberCardNumber = '';
			memberPhone = '';
			memberSpecialNeeds.clear();
			memberMedicalConditions = '';
			memberMedicalAllergies = '';
			memberMedicalMedications = '';
			memberMedicalNote = '';

			showAddMemberForm = false;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(`เกิดข้อผิดพลาดในการลงทะเบียนสมาชิก: ${msg}`);
		} finally {
			isSubmitting = false;
		}
	}

	function formatAddress(h: Household) {
		const parts = [];
		if (h.address_no) parts.push(h.address_no);
		if (h.village_no) {
			const v = h.village_no.replace(/^(ม\.|หมู่\s*)/, '');
			parts.push(`ม.${v}`);
		}
		if (h.subdistrict) {
			const s = h.subdistrict.replace(/^(ต\.|ตำบล\s*)/, '');
			parts.push(`ต.${s}`);
		}
		if (h.district) {
			const d = h.district.replace(/^(อ\.|อำเภอ\s*)/, '');
			parts.push(`อ.${d}`);
		}
		if (h.province) {
			const p = h.province.replace(/^(จ\.|จังหวัด\s*)/, '');
			parts.push(`จ.${p}`);
		}
		if (h.postal_code) parts.push(h.postal_code);
		return parts.join(' ');
	}
</script>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
	<!-- Column 1 & 2: Household Info Card & Registered Members Table -->
	<div class="space-y-6 lg:col-span-2">
		<!-- Household Card Details -->
		<div class="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
			<div
				class="absolute top-0 right-0 size-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-500/10"
			></div>
			<div class="flex items-start gap-4">
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500"
				>
					<CheckCircle class="size-6" />
				</div>
				<div>
					<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
						สร้างครัวเรือนล่วงหน้าสำเร็จ
					</h3>
					<p class="text-sm text-muted-foreground">
						ครัวเรือนได้รับการจัดตั้งแล้วในระบบ สถานะ:
						<span
							class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800"
						>
							ลงทะเบียนล่วงหน้า
						</span>
					</p>
				</div>
			</div>

			<div class="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-sm">
				<div>
					<span class="text-xs text-muted-foreground">ชื่อครัวเรือน</span>
					<p class="font-semibold text-slate-800 dark:text-slate-200">
						{createdHousehold.label}
					</p>
				</div>
				<div>
					<span class="text-xs text-muted-foreground">หัวหน้าครัวเรือน</span>
					<p class="font-semibold text-slate-800 dark:text-slate-200">
						{createdHead ? `${createdHead.first_name} ${createdHead.last_name}` : '—'}
					</p>
				</div>
				<div class="col-span-2">
					<span class="text-xs text-muted-foreground">ที่อยู่เดิม</span>
					<p class="font-medium text-slate-800 dark:text-slate-200">
						{formatAddress(createdHousehold)}
					</p>
				</div>
			</div>
		</div>

		<!-- Member List Card -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
			<div class="mb-4 flex items-center justify-between gap-4">
				<h3 class="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
					<Users class="size-5 text-primary" />
					รายชื่อสมาชิกในบ้าน ({householdMembers.length} คน)
				</h3>
				<Button
					variant="outline"
					size="sm"
					onclick={() => (showAddMemberForm = !showAddMemberForm)}
					class="h-8 gap-1.5"
				>
					<Plus class="size-4" />
					<span>ลงทะเบียนลูกบ้านเพิ่ม</span>
				</Button>
			</div>

			<div class="overflow-x-auto rounded-xl border">
				<table class="w-full border-collapse text-left text-sm">
					<thead>
						<tr class="border-b bg-muted/40">
							<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">ชื่อ-นามสกุล</th>
							<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">บทบาท</th>
							<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">ระบุตัวตน / โทร</th>
							<th class="p-3 font-semibold text-slate-700 dark:text-slate-300"
								>กลุ่มช่วยเหลือพิเศษ</th
							>
						</tr>
					</thead>
					<tbody>
						{#each householdMembers as m (m._id)}
							{@const isHead = m._id === createdHousehold.head_evacuee_id}
							<tr class="border-b transition-colors last:border-0 hover:bg-muted/10">
								<td class="p-3 font-bold text-slate-900 dark:text-slate-100">
									{m.first_name}
									{m.last_name}
									{#if m.nickname}
										<span class="text-xs font-normal text-muted-foreground">({m.nickname})</span>
									{/if}
								</td>
								<td class="p-3">
									{#if isHead}
										<span class="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
											หัวหน้าครอบครัว
										</span>
									{:else}
										<span
											class="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
										>
											ลูกบ้าน
										</span>
									{/if}
								</td>
								<td class="p-3 font-mono text-xs">
									<div>ID: {maskNationalId(m.person_id?.number)}</div>
									{#if m.phone}
										<div class="opacity-75">{m.phone}</div>
									{/if}
								</td>
								<td class="p-3">
									<div class="flex flex-wrap gap-1">
										{#if m.special_needs?.length > 0}
											{#each m.special_needs as need (need)}
												<span
													class="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
												>
													{SPECIAL_NEED_CHIPS[need]?.emoji}
													{SPECIAL_NEED_CHIPS[need]?.label}
												</span>
											{/each}
										{:else}
											<span class="text-xs text-muted-foreground italic">ไม่มี</span>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- Column 3: Printable QR Card Summary -->
	<div class="space-y-6">
		<!-- Wristband / QR Card Preview -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
			<h3 class="mb-4 text-sm font-bold text-slate-800 dark:text-slate-200">
				สลิปบัตรประจำตัวครอบครัว (Household Card)
			</h3>

			<div class="rounded-2xl bg-slate-100 p-4 dark:bg-slate-800">
				<div
					id="qr-identity-card"
					class="mx-auto flex max-w-[280px] flex-col items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-md"
				>
					<div class="border-b pb-2 text-center">
						<h4 class="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
							Smart Shelter Card
						</h4>
						<h3 class="mt-0.5 text-sm font-bold text-slate-800">
							ลงทะเบียนล่วงหน้า (Pre-registered)
						</h3>
					</div>

					<div class="my-4 flex items-center justify-center">
						{#if qrUrl}
							<img src={qrUrl} alt="QR Code" class="size-36 object-contain" />
						{:else}
							<div
								class="flex size-36 items-center justify-center rounded bg-slate-100 text-xs text-slate-400"
							>
								กำลังสร้าง QR...
							</div>
						{/if}
					</div>

					<div class="space-y-2 border-t pt-3 text-center">
						<h3 class="text-sm font-bold text-slate-900">
							🏡 {createdHousehold.label}
						</h3>
						<div
							class="inline-block rounded bg-slate-900 px-2 py-0.5 font-mono text-[9px] font-bold text-white uppercase"
						>
							ID: {createdHousehold._id.split(':')[1] ?? createdHousehold._id}
						</div>
						{#if createdHead}
							<p class="text-[10px] text-slate-500">
								หัวหน้า: {createdHead.first_name}
								{createdHead.last_name}
							</p>
						{/if}
					</div>
				</div>
			</div>

			<div class="mt-4 flex flex-col gap-2">
				<Button
					disabled={true}
					class="flex h-10 w-full items-center justify-center gap-1.5 bg-[#0d2240] text-white hover:bg-[#1a3a5c]"
				>
					<Printer class="size-4" />
					<span>พิมพ์บัตรประจำครอบครัว (ปิดใช้งานชั่วคราว)</span>
				</Button>
			</div>
		</div>
	</div>
</div>

<!-- ────────────────── MODAL/INLINE FORM: Add Member Form ────────────────── -->
{#if showAddMemberForm}
	<div
		class="mt-8 animate-in rounded-3xl border border-border bg-card p-6 shadow-md duration-200 slide-in-from-top-3"
	>
		<div
			class="mb-6 flex flex-col gap-4 border-b pb-3 sm:flex-row sm:items-center sm:justify-between"
		>
			<h3 class="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-200">
				<User class="size-5 text-primary" />
				ลงทะเบียนสมาชิกคนใหม่ในครอบครัว
			</h3>
			<div class="flex items-center gap-3">
				<button
					type="button"
					onclick={handlePullMemberIdCard}
					class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#003B71] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#002a50]"
				>
					<CreditCard class="size-4" /> ดึงข้อมูลบัตรประชาชน
				</button>
				<button
					type="button"
					class="text-sm font-medium text-muted-foreground hover:text-foreground"
					onclick={() => (showAddMemberForm = false)}
				>
					✖ ปิด
				</button>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
			<div class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="mem-fn">ชื่อจริง <span class="text-destructive">*</span></Label>
						<Input id="mem-fn" placeholder="ชื่อจริง" bind:value={memberFirstName} required />
					</div>
					<div class="space-y-2">
						<Label for="mem-ln">นามสกุล <span class="text-destructive">*</span></Label>
						<Input id="mem-ln" placeholder="นามสกุล" bind:value={memberLastName} required />
					</div>
				</div>

				<div class="grid grid-cols-3 gap-4">
					<div class="space-y-2">
						<Label for="mem-nn">ชื่อเล่น</Label>
						<Input id="mem-nn" placeholder="ชื่อเล่น" bind:value={memberNickname} />
					</div>
					<div class="space-y-2">
						<Label>เพศ</Label>
						<select
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							bind:value={memberGender}
						>
							<option value="male">ชาย</option>
							<option value="female">หญิง</option>
							<option value="other">อื่นๆ</option>
						</select>
					</div>
					<div class="space-y-2">
						<Label for="mem-phone">เบอร์โทรศัพท์</Label>
						<Input
							id="mem-phone"
							placeholder="เบอร์โทรศัพท์"
							bind:value={memberPhone}
							maxlength={10}
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="mem-by">ปีเกิด (พ.ศ.)</Label>
						<Input id="mem-by" placeholder="เช่น 2530" bind:value={memberBirthYear} />
					</div>
					<div class="space-y-2">
						<Label for="mem-age">อายุ (ปี)</Label>
						<Input
							id="mem-age"
							placeholder="อายุ"
							bind:value={memberAge}
							inputmode="numeric"
							maxlength={3}
							oninput={(e) => {
								const val = e.currentTarget.value.replace(/\D/g, '');
								e.currentTarget.value = val;
								memberAge = val;
							}}
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label>ประเภทบัตรประจำตัว</Label>
						<select
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							bind:value={memberCardType}
						>
							<option value="national_id">บัตรประชาชน</option>
							<option value="passport">พาสปอร์ต</option>
							<option value="pink_card">บัตรสีชมพู</option>
							<option value="other">อื่นๆ</option>
						</select>
					</div>
					<div class="space-y-2">
						<Label for="mem-cardno">เลขบัตร / หนังสือเดินทาง</Label>
						<Input id="mem-cardno" placeholder="หมายเลขบัตร" bind:value={memberCardNumber} />
					</div>
				</div>
			</div>

			<div class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label>สัญชาติ</Label>
						<select
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							bind:value={memberCountry}
						>
							{#each COUNTRIES as c (c.value)}
								<option value={c.value}>{c.label}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<Label>ศาสนา</Label>
						<select
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							bind:value={memberReligion}
						>
							<option value="buddhist">พุทธ</option>
							<option value="muslim">อิสลาม</option>
							<option value="christian">คริสต์</option>
							<option value="other">อื่นๆ</option>
							<option value="unknown">ไม่ระบุ</option>
						</select>
					</div>
				</div>

				<!-- Special Needs Chips -->
				<div class="space-y-2 border-t pt-4">
					<Label class="text-sm font-semibold">ความต้องการพิเศษ / กลุ่มเปราะบาง</Label>
					<div class="flex flex-wrap gap-2 pt-1">
						{#each Object.entries(SPECIAL_NEED_CHIPS) as [key, chip] (key)}
							{@const checked = memberSpecialNeeds.has(key as SpecialNeed)}
							<Button
								type="button"
								variant="outline"
								onclick={() => toggleSpecialNeed(memberSpecialNeeds, key as SpecialNeed)}
								class="inline-flex h-auto items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-normal transition-colors 
								{checked
									? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15'
									: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
							>
								<span>{chip.emoji}</span>
								<span>{chip.label}</span>
							</Button>
						{/each}
					</div>
				</div>

				<!-- Health & Medical Details -->
				<div class="space-y-3 border-t pt-4">
					<Label class="text-sm font-semibold">ข้อมูลสุขภาพ & ยาประจำตัว</Label>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="mem-med-cond" class="text-xs text-muted-foreground">โรคประจำตัว</Label>
							<Input
								id="mem-med-cond"
								placeholder="เช่น โรคหอบหืด"
								bind:value={memberMedicalConditions}
							/>
						</div>
						<div class="space-y-2">
							<Label for="mem-med-all" class="text-xs text-muted-foreground">ประวัติการแพ้</Label>
							<Input
								id="mem-med-all"
								placeholder="แพ้ยา/อาหาร"
								bind:value={memberMedicalAllergies}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div class="mt-6 flex justify-end gap-3 border-t pt-4">
			<Button variant="outline" onclick={() => (showAddMemberForm = false)}>ยกเลิก</Button>
			<Button
				onclick={handleAddMember}
				disabled={isSubmitting || !memberFirstName || !memberLastName}
				class="bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
			>
				{isSubmitting ? 'กำลังบันทึก...' : 'เพิ่มสมาชิกเข้าร่วมครัวเรือน'}
			</Button>
		</div>
	</div>
{/if}

<!-- Action Row Step 4 -->
<div class="mt-8 flex items-center justify-between border-t border-border pt-4">
	<p class="text-xs text-muted-foreground">
		💡 บันทึกสมาชิกสำเร็จแล้ว สมาชิกทุกคนจะผูกอยู่กับครัวเรือนนี้
	</p>
	<Button
		onclick={() => goto(resolve('/back-office/evacuee-management?tab=household'))}
		class="h-11 bg-emerald-600 px-8 font-semibold text-white hover:bg-emerald-700"
	>
		เสร็จสิ้นการลงทะเบียนล่วงหน้า ✔
	</Button>
</div>

<style>
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		#qr-identity-card,
		#qr-identity-card * {
			visibility: visible;
		}
		#qr-identity-card {
			position: absolute;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%) scale(1.6);
			border: 2px solid #000 !important;
			box-shadow: none !important;
			background-color: #fff !important;
			color: #000 !important;
		}
	}
</style>
