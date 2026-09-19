<script lang="ts">
	import IdCard from '@lucide/svelte/icons/id-card';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import User from '@lucide/svelte/icons/user';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Baby from '@lucide/svelte/icons/baby';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { fetchThaidRegistrationStatus, type ThaidStatusResponse } from '$lib/api/thaid-status';
	import type { ThaiDAutofillProfile } from '../../domain/thaid-profile';

	const MOCK_PROFILES: ThaiDAutofillProfile[] = [
		{
			id: 'adult-head',
			roleLabel: 'ผู้ใหญ่ทั่วไป (หัวหน้าครอบครัว)',
			person_id: '1100500123456',
			first_name: 'สมชาย',
			last_name: 'มั่นคง',
			nickname: 'ชาย',
			gender: 'male',
			birth_year: 2528,
			age: 41,
			phone: '0812345678',
			vulnerable_groups: [],
			special_needs: [],
			medical_conditions: [],
			address: {
				address_no: '123/45',
				village_no: 'หมู่ 2',
				subdistrict: 'ช้างเผือก',
				district: 'เมืองเชียงใหม่',
				province: 'เชียงใหม่',
				postal_code: '50300'
			}
		},
		{
			id: 'elderly-vulnerable',
			roleLabel: 'ผู้สูงอายุ / เปราะบาง (ต้องการรถเข็น)',
			person_id: '3509900234567',
			first_name: 'สมศรี',
			last_name: 'มีสุข',
			nickname: 'ยายศรี',
			gender: 'female',
			birth_year: 2485,
			age: 84,
			phone: '0898765432',
			vulnerable_groups: ['elderly', 'mobility_impaired'],
			special_needs: ['wheelchair_user'],
			medical_conditions: ['ความดันโลหิตสูง', 'ข้อเข่าเสื่อม'],
			address: {
				address_no: '123/45',
				village_no: 'หมู่ 2',
				subdistrict: 'ช้างเผือก',
				district: 'เมืองเชียงใหม่',
				province: 'เชียงใหม่',
				postal_code: '50300'
			}
		},
		{
			id: 'child-no-phone',
			roleLabel: 'เด็กเล็ก (ไม่มีเบอร์โทรศัพท์ส่วนตัว)',
			person_id: '1509901345678',
			first_name: 'กล้าหาญ',
			last_name: 'มั่นคง',
			nickname: 'น้องกล้า',
			gender: 'male',
			birth_year: 2560,
			age: 9,
			phone: null,
			vulnerable_groups: ['child'],
			special_needs: [],
			medical_conditions: [],
			address: {
				address_no: '123/45',
				village_no: 'หมู่ 2',
				subdistrict: 'ช้างเผือก',
				district: 'เมืองเชียงใหม่',
				province: 'เชียงใหม่',
				postal_code: '50300'
			}
		}
	];

	interface Props {
		status?: {
			enabled: boolean;
			isDev: boolean;
			mode: 'mock' | 'real';
		} | null;
		disabled?: boolean;
		onautofill?: (profile: ThaiDAutofillProfile) => void;
	}

	let { status = undefined, disabled = false, onautofill }: Props = $props();

	let open = $state(false);
	let isRedirecting = $state(false);
	let fetchedStatus = $state<ThaidStatusResponse | null>(null);

	onMount(() => {
		if (status === undefined) {
			void fetchThaidRegistrationStatus().then((res) => {
				fetchedStatus = res;
			});
		}
	});

	const effectiveStatus = $derived<ThaidStatusResponse | null>(
		status !== undefined ? status : fetchedStatus
	);

	const isDevEnv = import.meta.env.DEV;
	const isEnabled = $derived(effectiveStatus ? effectiveStatus.enabled : isDevEnv);
	const isMock = $derived(
		effectiveStatus ? effectiveStatus.isDev || effectiveStatus.mode === 'mock' : isDevEnv
	);

	function handleSelect(profile: ThaiDAutofillProfile) {
		onautofill?.(profile);
		open = false;
	}

	function handleRealConnect() {
		if (isRedirecting) return;
		isRedirecting = true;
		const currentUrl = new URL(window.location.href);
		currentUrl.searchParams.delete('error');
		currentUrl.searchParams.delete('thaid');
		const returnTo = currentUrl.pathname + (currentUrl.search ? currentUrl.search : '');
		window.location.href = `/api/v1/auth/oauth/thaid/start?mode=register&return_to=${encodeURIComponent(returnTo)}`;
	}
</script>

{#if isEnabled}
	<div class="rounded-xl border border-primary/20 bg-primary/5 p-3.5 sm:p-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-start gap-2.5">
				<div
					class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
				>
					<IdCard class="size-4" />
				</div>
				<div>
					<div class="flex items-center gap-2">
						<span class="text-sm font-semibold text-foreground">ดึงข้อมูลด้วย ThaiD</span>
						{#if isMock}
							<Badge
								variant="outline"
								class="border-amber-500/30 bg-amber-500/10 text-xs text-amber-700"
							>
								จำลอง / Mock
							</Badge>
						{/if}
					</div>
					<p class="mt-0.5 text-xs text-muted-foreground">
						{isMock
							? 'ระบบจำลองการอ่านข้อมูลบัตรประชาชนดิจิทัล สำหรับทดสอบเติมข้อมูลและที่อยู่'
							: 'เชื่อมต่อและดึงข้อมูลทะเบียนราษฎร์อัตโนมัติ'}
					</p>
				</div>
			</div>

			{#if isMock}
				<Dialog.Root bind:open>
					<Dialog.Trigger>
						{#snippet child({ props })}
							<Button
								type="button"
								variant="outline"
								size="sm"
								{disabled}
								class="min-h-10 border-primary/30 text-primary hover:bg-primary/10"
								{...props}
							>
								<Sparkles class="mr-1.5 size-4" />
								<span>เลือกข้อมูลจำลอง (Mock)</span>
							</Button>
						{/snippet}
					</Dialog.Trigger>

					<Dialog.Content class="sm:max-w-lg">
						<Dialog.Header>
							<Dialog.Title class="flex items-center gap-2 text-base font-bold sm:text-lg">
								<IdCard class="size-5 text-primary" />
								<span>จำลองการอ่านข้อมูล ThaiD</span>
							</Dialog.Title>
							<Dialog.Description class="text-xs text-muted-foreground">
								เลือกชุดข้อมูลพลเมืองตัวอย่างเพื่อทดสอบการกรอกข้อมูลบ้านและสมาชิกโดยอัตโนมัติ
							</Dialog.Description>
						</Dialog.Header>

						<div class="mt-3 space-y-2.5">
							{#each MOCK_PROFILES as p (p.id)}
								<button
									type="button"
									class="flex w-full cursor-pointer flex-col gap-1.5 rounded-xl border border-border/80 bg-card p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus:ring-2 focus:ring-primary/40 focus:outline-none"
									onclick={() => handleSelect(p)}
								>
									<div class="flex items-center justify-between">
										<span class="text-sm font-semibold text-foreground">
											{p.first_name}
											{p.last_name}
											{#if p.nickname}
												<span class="font-normal text-muted-foreground">({p.nickname})</span>
											{/if}
										</span>
										<span
											class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
										>
											{p.person_id}
										</span>
									</div>

									<div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
										<span class="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5">
											{#if p.id === 'adult-head'}
												<User class="size-3" />
											{:else if p.id === 'elderly-vulnerable'}
												<ShieldAlert class="size-3 text-amber-600" />
											{:else}
												<Baby class="size-3 text-blue-600" />
											{/if}
											<span>{p.roleLabel}</span>
										</span>
										<span>·</span>
										<span>อายุ {p.age} ปี (พ.ศ. {p.birth_year})</span>
										<span>·</span>
										<span>{p.phone ? p.phone : 'ไม่มีเบอร์โทร'}</span>
									</div>

									<div class="mt-0.5 text-xs text-muted-foreground">
										<span
											>ที่อยู่: {p.address.address_no}
											{p.address.village_no} ต.{p.address.subdistrict} อ.{p.address.district} จ.{p
												.address.province}
											{p.address.postal_code}</span
										>
									</div>
								</button>
							{/each}
						</div>

						<Dialog.Footer class="mt-4">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="min-h-10"
								onclick={() => (open = false)}
							>
								ยกเลิก
							</Button>
						</Dialog.Footer>
					</Dialog.Content>
				</Dialog.Root>
			{:else}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled || isRedirecting}
					onclick={handleRealConnect}
					class="min-h-10 border-primary/30 text-primary hover:bg-primary/10"
				>
					{#if isRedirecting}
						<Loader2 class="mr-1.5 size-4 animate-spin" />
						<span>กำลังเชื่อมต่อ ThaiD...</span>
					{:else}
						<Sparkles class="mr-1.5 size-4" />
						<span>เชื่อมต่อ ThaiD</span>
					{/if}
				</Button>
			{/if}
		</div>
	</div>
{/if}
