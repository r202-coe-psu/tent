<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Clock from '@lucide/svelte/icons/clock';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import Button from '$lib/components/ui/button/button.svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		familySearch,
		isInShelterStatus,
		searchResultKey,
		type FamilySearchResult
	} from '$lib/features/public-portal';

	let query = $state('');
	let isLoading = $state(false);
	let results = $state<FamilySearchResult[] | null>(null);
	let error = $state('');

	let currentPage = $state(1);
	const itemsPerPage = 5;

	let paginatedResults = $derived(
		results ? results.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage) : null
	);
	let totalPages = $derived(results ? Math.ceil(results.length / itemsPerPage) : 0);

	onMount(() => {
		const q = page.url.searchParams.get('q');
		if (q) {
			query = q;
			performSearch();
		}
	});

	async function performSearch() {
		if (query.length < 3) {
			error = 'กรุณากรอกข้อมูลอย่างน้อย 3 ตัวอักษร';
			return;
		}
		isLoading = true;
		error = '';
		results = null;

		try {
			const data = await familySearch(query);
			results = data.results;
			currentPage = 1;
		} catch (e) {
			error = e instanceof Error ? e.message : 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้';
		} finally {
			isLoading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') performSearch();
	}

	function formatDateTime(isoString: string) {
		if (!isoString) return 'ไม่ระบุเวลา';
		return new Date(isoString).toLocaleString('th-TH') + ' น.';
	}

	function genderLabel(gender: string | null | undefined) {
		if (gender === 'male') return 'ชาย';
		if (gender === 'female') return 'หญิง';
		return 'อื่นๆ';
	}
</script>

<div class="mx-auto max-w-5xl px-4 py-8">
	<!-- Hero Section -->
	<div class="mb-8 overflow-hidden rounded-2xl bg-primary-dark p-8 text-white shadow-lg lg:p-12">
		<div
			class="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wider text-white/90 uppercase"
		>
			<Search class="h-4 w-4" /> RESTORING FAMILY LINKS
		</div>
		<h1 class="mb-4 text-3xl font-bold md:text-4xl">ระบบสืบค้นญาติและครอบครัว</h1>
		<p class="text-white/80">
			สืบค้นและตรวจสอบสถานะความปลอดภัยของบุคคลในครอบครัว
			เพื่อบรรเทาความเครียดโดยไม่ต้องออกเดินทางตามหา ด้วยระบบคุ้มครองข้อมูลส่วนบุคคล (PDPA)
		</p>
	</div>

	<!-- Search Box -->
	<div class="rounded-2xl border border-border bg-white p-6 shadow-sm">
		<h2 class="mb-2 text-center text-xl font-bold">กรอกข้อมูลเพื่อค้นหา</h2>
		<p class="mb-6 text-center text-sm text-muted-foreground">
			รองรับการค้นหาด้วย ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน
		</p>

		<!-- Input -->
		<div class="flex flex-col gap-3 sm:flex-row">
			<div
				class="relative flex flex-1 items-center gap-3 rounded-xl border border-border bg-muted/50 px-4"
			>
				<Search class="h-5 w-5 text-muted-foreground/80" />
				<input
					type="text"
					bind:value={query}
					onkeydown={handleKeydown}
					placeholder="พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน..."
					class="h-12 w-full bg-transparent outline-none"
				/>
			</div>
			<Button
				onclick={performSearch}
				disabled={isLoading}
				class="h-12 min-w-30 rounded-xl bg-primary text-white hover:bg-primary-dark"
			>
				{#if isLoading}
					กำลังค้นหา...
				{:else}
					ค้นหา
				{/if}
			</Button>
		</div>

		{#if error}
			<p class="mt-3 text-center text-sm text-danger">{error}</p>
		{/if}
	</div>

	<!-- Results -->
	{#if results !== null}
		{#if results.length > 0}
			<div class="mt-8">
				<div
					class="mb-4 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm font-semibold text-foreground/90"
				>
					<CheckCircle class="h-5 w-5 text-primary" />
					พบข้อมูลทั้งหมด {results.length} รายการ
				</div>

				<div class="flex flex-col gap-6">
					{#each paginatedResults ?? [] as person, i (searchResultKey(person, i))}
						<div class="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
							<!-- Card Header -->
							<div class="flex items-start justify-between border-b border-border/50 p-5">
								<div>
									<div class="flex items-center gap-3">
										<h3 class="text-xl font-bold text-foreground">
											{person.name || 'ไม่ระบุชื่อ'}
										</h3>
										{#if person.family_members && person.family_members.length > 0}
											<span
												class="rounded-md bg-primary/20 px-2 py-0.5 text-xs font-bold text-primary"
												>มากับครอบครัว</span
											>
										{:else}
											<span
												class="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground"
												>มาเดี่ยว</span
											>
										{/if}
									</div>
									<div class="mt-2 flex gap-4 text-sm text-muted-foreground">
										<span>ID: <span class="font-mono">{person.national_id || '-'}</span></span>
										<span>เพศ: {genderLabel(person.gender)}</span>
									</div>
								</div>

								{#if isInShelterStatus(person.status)}
									<div
										class="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-bold text-green-700"
									>
										<div class="h-2 w-2 rounded-full bg-green-500"></div>
										ปลอดภัย (อยู่ในศูนย์แล้ว)
									</div>
								{:else}
									<div
										class="flex items-center gap-1.5 rounded-full border border-danger-border bg-danger-muted px-3 py-1.5 text-sm font-bold text-danger"
									>
										<div class="h-2 w-2 rounded-full bg-danger"></div>
										ไม่อยู่ในศูนย์
									</div>
								{/if}
							</div>

							<!-- Card Body -->
							<div class="grid grid-cols-1 gap-6 bg-muted/50 p-5 sm:grid-cols-2">
								<div class="flex gap-3">
									<MapPin class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">พำนักอยู่ที่ศูนย์พักพิง</div>
										<div class="font-medium text-foreground">{person.shelter_name || '-'}</div>
									</div>
								</div>
								<div class="flex gap-3">
									<MapPin class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">ภูมิลำเนาเดิม</div>
										<div class="font-medium text-foreground">{person.origin_address || '-'}</div>
									</div>
								</div>
								<div class="flex gap-3">
									<Clock class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">เวลาลงทะเบียนเข้าพัก</div>
										<div class="font-medium text-foreground">
											{person.checked_in_at ? formatDateTime(person.checked_in_at) : '-'}
										</div>
									</div>
								</div>
								<div class="flex gap-3">
									<User class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">สถานะความดูแล (โซน)</div>
										<div class="font-medium text-foreground">{person.care_zone || '-'}</div>
									</div>
								</div>
							</div>

							{#if person.family_members && person.family_members.length > 0}
								<div class="border-t border-border/50 p-5">
									<div class="mb-4 flex items-center gap-2 font-bold text-foreground/90">
										<Users class="h-5 w-5" />
										ข้อมูลสมาชิกในครอบครัว ({person.family_members.length} คน)
									</div>
									<div class="flex flex-col gap-3">
										{#each person.family_members as member, i (i)}
											<div
												class="flex items-center justify-between rounded-xl border border-border p-4"
											>
												<div>
													<div class="font-bold text-foreground">
														{member.name || '-'}
													</div>
												</div>
												{#if isInShelterStatus(member.status)}
													<div class="text-sm font-bold text-green-600">
														ปลอดภัยอยู่ในศูนย์ ({member.shelter_name || '-'})
													</div>
												{:else}
													<div class="text-sm font-bold text-danger">พลัดหลง (ไม่อยู่ในศูนย์)</div>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Pagination -->
				{#if totalPages > 1}
					<div class="mt-8 flex items-center justify-center gap-4">
						<Button
							variant="outline"
							disabled={currentPage === 1}
							onclick={() => currentPage--}
							class="rounded-lg"
						>
							ก่อนหน้า
						</Button>
						<span class="text-sm font-bold text-muted-foreground">
							หน้า {currentPage} จาก {totalPages}
						</span>
						<Button
							variant="outline"
							disabled={currentPage === totalPages}
							onclick={() => currentPage++}
							class="rounded-lg"
						>
							ถัดไป
						</Button>
					</div>
				{/if}
			</div>
		{:else}
			<div
				class="mt-8 rounded-2xl border border-dashed border-border bg-muted/50 p-12 text-center text-muted-foreground"
			>
				<div
					class="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-white p-4 shadow-sm"
				>
					<Search class="size-10 text-muted-foreground" />
				</div>
				<h3 class="mb-2 text-lg font-bold text-foreground/90">ไม่พบรายชื่อ</h3>
				<p class="text-sm">ไม่พบข้อมูลที่ตรงกับการค้นหา กรุณาตรวจสอบความถูกต้องอีกครั้ง</p>
			</div>
		{/if}
	{:else}
		<div
			class="mt-8 rounded-2xl border border-dashed border-border bg-muted/50 p-12 text-center text-muted-foreground"
		>
			<div
				class="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-white p-4 shadow-sm"
			>
				<Search class=" size-10 text-muted-foreground" />
			</div>
			<h3 class="mb-2 text-lg font-bold text-foreground/90">เริ่มการค้นหา</h3>
			<p class="text-sm">
				พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน เพื่อทำการสืบค้นข้อมูล
			</p>
		</div>
	{/if}
</div>
