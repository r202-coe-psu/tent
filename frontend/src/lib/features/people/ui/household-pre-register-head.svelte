<script lang="ts">
	import {
		SPECIAL_NEED_CHIPS,
		type SpecialNeed,
		type Gender,
		type Religion,
		type CardType
	} from '../domain/people';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { COUNTRIES } from '$lib/utils/country';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Camera from '@lucide/svelte/icons/camera';
	import { toast } from 'svelte-sonner';

	let facePhotoUrl = $state<string | null>(null);
	let noPhone = $state(false);

	$effect(() => {
		if (noPhone) {
			form.phone = '';
		}
	});

	interface HeadFormState {
		firstName: string;
		lastName: string;
		nickname: string;
		gender: Gender;
		phone: string;
		birthYear: string;
		age: string;
		cardType: CardType;
		cardNumber: string;
		country: string;
		religion: Religion;
		specialNeeds: Set<SpecialNeed>;
		emergencyName: string;
		emergencyPhone: string;
		emergencyRelation: string;
		medicalConditions: string;
		medicalAllergies: string;
		medicalMedications: string;
		medicalNote: string;
	}

	let {
		form = $bindable(),
		onNext
	}: {
		form: HeadFormState;
		onNext: () => void;
	} = $props();

	function toggleSpecialNeed(need: SpecialNeed) {
		if (form.specialNeeds.has(need)) {
			form.specialNeeds.delete(need);
		} else {
			form.specialNeeds.add(need);
		}
		// Trigger Svelte reactivity
		form.specialNeeds = new Set(form.specialNeeds);
	}

	function handleNext() {
		if (!form.firstName.trim() || !form.lastName.trim()) {
			toast.error('กรุณากรอกชื่อและนามสกุลของหัวหน้าครัวเรือน');
			return;
		}
		if (!noPhone && (!form.phone.trim() || form.phone.trim().replace(/\D/g, '').length !== 10)) {
			toast.error('กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลือก "ไม่มีเบอร์โทร"');
			return;
		}
		onNext();
	}
</script>

<div class="mx-auto w-full max-w-5xl space-y-6">
	<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
		<div class="mb-6 border-b pb-4">
			<h3 class="text-base font-bold text-slate-800 dark:text-slate-200">ข้อมูลหัวหน้าครัวเรือน</h3>
		</div>

		<div class="grid grid-cols-1 items-start gap-6 md:grid-cols-[200px_1fr]">
			<!-- Column 1: Face Photo mockup -->
			<div class="space-y-2">
				<p class="text-sm leading-none font-medium text-foreground">
					ภาพถ่ายใบหน้า (Face Recognition)
				</p>
				<input
					type="file"
					accept="image/*"
					class="hidden"
					id="face-photo-input"
					onchange={(e) => {
						const file = e.currentTarget.files?.[0];
						if (file) {
							facePhotoUrl = URL.createObjectURL(file);
						}
					}}
				/>
				<label
					for="face-photo-input"
					class="block cursor-pointer rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-4 text-center transition-all hover:border-primary/50 hover:bg-muted/30"
				>
					{#if facePhotoUrl}
						<img src={facePhotoUrl} alt="Face" class="h-40 w-full rounded-lg object-cover" />
					{:else}
						<div class="flex h-40 flex-col items-center justify-center">
							<Camera class="mb-2 h-10 w-10 text-muted-foreground" />
							<span class="text-xs text-muted-foreground">แตะเพื่อถ่ายภาพ</span>
						</div>
					{/if}
				</label>
			</div>

			<!-- Column 2: Fields grid -->
			<div class="space-y-4">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label>ประเภทบัตรประจำตัว</Label>
						<select
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							bind:value={form.cardType}
						>
							<option value="national_id">บัตรประชาชน</option>
							<option value="passport">พาสปอร์ต</option>
							<option value="pink_card">บัตรสีชมพู</option>
							<option value="other">อื่นๆ</option>
						</select>
					</div>
					<div class="space-y-2">
						<Label for="head-cardno">เลขบัตร / หนังสือเดินทาง</Label>
						<Input id="head-cardno" placeholder="หมายเลขบัตร" bind:value={form.cardNumber} />
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="head-fn">ชื่อจริง <span class="text-destructive">*</span></Label>
						<Input id="head-fn" placeholder="ชื่อจริง" bind:value={form.firstName} required />
					</div>
					<div class="space-y-2">
						<Label for="head-ln">นามสกุล <span class="text-destructive">*</span></Label>
						<Input id="head-ln" placeholder="นามสกุล" bind:value={form.lastName} required />
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="head-nn">ชื่อเล่น</Label>
						<Input id="head-nn" placeholder="ชื่อเล่น" bind:value={form.nickname} />
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
					<div class="space-y-2">
						<Label>ปีเกิด (พ.ศ.)</Label>
						<Input id="head-birthyear" placeholder="เช่น 2530" bind:value={form.birthYear} />
					</div>
					<div class="space-y-2">
						<Label>อายุ (ปี)</Label>
						<Input
							id="head-age"
							placeholder="อายุ"
							bind:value={form.age}
							inputmode="numeric"
							maxlength={3}
							oninput={(e) => {
								const val = e.currentTarget.value.replace(/\D/g, '');
								e.currentTarget.value = val;
								form.age = val;
							}}
						/>
					</div>
					<div class="space-y-2">
						<Label>เพศ <span class="text-destructive">*</span></Label>
						<select
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							bind:value={form.gender}
						>
							<option value="male">ชาย</option>
							<option value="female">หญิง</option>
							<option value="other">อื่นๆ</option>
						</select>
					</div>
					<div class="space-y-2">
						<Label>เบอร์โทรศัพท์ <span class="text-destructive">*</span></Label>
						<Input
							id="head-phone"
							placeholder="เบอร์โทรศัพท์"
							disabled={noPhone}
							bind:value={form.phone}
							maxlength={10}
						/>
						<label class="mt-1.5 flex cursor-pointer items-center gap-2 text-xs">
							<Checkbox
								checked={noPhone}
								onCheckedChange={(v) => {
									noPhone = !!v;
									if (noPhone) {
										form.phone = '';
									}
								}}
							/>
							<span class="text-muted-foreground">ไม่มีเบอร์โทร</span>
						</label>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label>สัญชาติ</Label>
						<select
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							bind:value={form.country}
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
							bind:value={form.religion}
						>
							<option value="buddhist">พุทธ</option>
							<option value="muslim">อิสลาม</option>
							<option value="christian">คริสต์</option>
							<option value="other">อื่นๆ</option>
							<option value="unknown">ไม่ระบุ</option>
						</select>
					</div>
				</div>
			</div>
		</div>

		<!-- Special Needs Chips -->
		<div class="mt-6 space-y-2 border-t pt-4">
			<Label class="text-sm font-semibold">ความต้องการพิเศษ / กลุ่มเปราะบาง</Label>
			<div class="flex flex-wrap gap-2 pt-1">
				{#each Object.entries(SPECIAL_NEED_CHIPS) as [key, chip] (key)}
					{@const checked = form.specialNeeds.has(key as SpecialNeed)}
					<Button
						type="button"
						variant="outline"
						onclick={() => toggleSpecialNeed(key as SpecialNeed)}
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

		<!-- Emergency Contact -->
		<div class="mt-6 space-y-4 rounded-xl border border-border bg-slate-50/50 p-4">
			<h4
				class="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase"
			>
				<ShieldAlert class="size-4 text-amber-500" />
				ข้อมูลผู้ติดต่อฉุกเฉิน
			</h4>
			<div class="grid grid-cols-3 gap-4">
				<div class="space-y-2">
					<Label for="head-ec-name">ชื่อผู้ติดต่อ</Label>
					<Input id="head-ec-name" placeholder="ชื่อ-นามสกุล" bind:value={form.emergencyName} />
				</div>
				<div class="space-y-2">
					<Label for="head-ec-relation">ความสัมพันธ์</Label>
					<Input
						id="head-ec-relation"
						placeholder="เช่น ญาติ, เพื่อน"
						bind:value={form.emergencyRelation}
					/>
				</div>
				<div class="space-y-2">
					<Label for="head-ec-phone">เบอร์ติดต่อ</Label>
					<Input
						id="head-ec-phone"
						placeholder="เบอร์โทรศัพท์"
						bind:value={form.emergencyPhone}
						maxlength={10}
					/>
				</div>
			</div>
		</div>

		<!-- Medical Info -->
		<div class="mt-6 space-y-3 border-t pt-4">
			<Label class="text-sm font-semibold">ข้อมูลสุขภาพ & ยาประจำตัว</Label>
			<div class="space-y-2">
				<Label for="head-med-cond" class="text-xs text-muted-foreground"
					>โรคประจำตัว (คั่นด้วยจุลภาค `,` ถ้ามีหลายโรค)</Label
				>
				<Input
					id="head-med-cond"
					placeholder="เช่น เบาหวาน, ความดัน"
					bind:value={form.medicalConditions}
				/>
			</div>
			<div class="space-y-2">
				<Label for="head-med-all" class="text-xs text-muted-foreground"
					>ประวัติการแพ้ยา/แพ้อาหาร</Label
				>
				<Input
					id="head-med-all"
					placeholder="เช่น แพ้เพนิซิลลิน, แพ้อาหารทะเล"
					bind:value={form.medicalAllergies}
				/>
			</div>
			<div class="space-y-2">
				<Label for="head-med-meds" class="text-xs text-muted-foreground"
					>ยาที่ต้องใช้เป็นประจำ</Label
				>
				<Input
					id="head-med-meds"
					placeholder="เช่น ยาอินซูลิน"
					bind:value={form.medicalMedications}
				/>
			</div>
			<div class="space-y-2">
				<Label for="head-med-note" class="text-xs text-muted-foreground"
					>ข้อมูลการดูแลพิเศษเพิ่มเติม</Label
				>
				<textarea
					id="head-med-note"
					placeholder="ระบุข้อมูลเพิ่มเติมในการช่วยเหลือและส่งต่อ"
					class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
					bind:value={form.medicalNote}
				></textarea>
			</div>
		</div>
	</div>

	<!-- Navigation -->
	<div class="mt-8 flex justify-end border-t border-border pt-4">
		<Button
			onclick={handleNext}
			disabled={!form.firstName || !form.lastName}
			class="h-11 bg-[#0d2240] px-8 font-semibold text-white hover:bg-[#1a3a5c]"
		>
			ถัดไป (ข้อมูลที่อยู่ครัวเรือน) →
		</Button>
	</div>
</div>
