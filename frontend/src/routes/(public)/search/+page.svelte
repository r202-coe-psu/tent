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
		searchResultKey,
		PublicHeroMetrics,
		PublicPageShell,
		StayStatusChip,
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

<svelte:head>
	<title>ระบบสืบค้นญาติและครอบครัว - Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-8">
	<PublicHeroMetrics
		title="ระบบสืบค้นญาติและครอบครัว"
		description="สืบค้นและตรวจสอบสถานะความปลอดภัยของบุคคลในครอบครัว เพื่อบรรเทาความเครียดโดยไม่ต้องออกเดินทางตามหา ด้วยระบบคุ้มครองข้อมูลส่วนบุคคล (PDPA)"
		badgeText="Restoring Family Links"
		badgeIcon={Search}
		showLivePing={false}
		bgClass="bg-primary-dark"
		showSearch={false}
	/>

	<!-- Search Box -->
	<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
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
			<div>
				<div
					class="mb-4 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm font-semibold text-foreground/90"
				>
					<CheckCircle class="h-5 w-5 text-primary" />
					พบข้อมูลทั้งหมด {results.length} รายการ
				</div>

				<div class="flex flex-col gap-6">
					{#each paginatedResults ?? [] as person, i (searchResultKey(person, (currentPage - 1) * itemsPerPage + i))}
						<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
							<!-- Card Header -->
							<div
								class="items-start justify-between space-y-1 border-b border-border/50 p-5 md:flex"
							>
								<div>
									<div class="items-center gap-3 space-y-1 md:flex">
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
									<div class="mt-2 gap-4 text-sm text-muted-foreground md:flex">
										<p>ID: <span class="font-mono">{person.national_id || '-'}</span></p>
										<p>เพศ: {genderLabel(person.gender)}</p>
									</div>
								</div>

								<!-- Real stay status, labelled exactly as the backoffice labels it (CR-080). -->
								<StayStatusChip status={person.status} />
							</div>

							<!-- Card Body -->
							<div class="grid grid-cols-1 gap-6 bg-muted/50 p-5 sm:grid-cols-2">
								<div class="flex gap-3">
									<MapPin class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">อาศัยอยู่ที่ศูนย์พักพิง</div>
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
								<!--
									Open by default: someone searching for a relative wants the rest of
									the household on screen without a second click — that is usually the
									answer they came for ("did the whole family make it?").
								-->
								<details open class="group border-t border-border/50 p-5">
									<summary
										class="mb-4 flex cursor-pointer list-none items-center gap-2 font-bold text-foreground/90 transition-colors hover:text-primary"
									>
										<Users class="h-5 w-5" />
										ข้อมูลสมาชิกในครอบครัว ({person.family_members.length} คน)
										<span
											class="ml-auto text-xs font-normal text-muted-foreground group-open:hidden"
											>คลิกเพื่อดู</span
										>
										<span
											class="ml-auto hidden text-xs font-normal text-muted-foreground group-open:inline"
											>ซ่อน</span
										>
									</summary>
									<div class="mt-4 flex flex-col gap-3">
										{#each person.family_members as member, i (i)}
											<div
												class="flex flex-col justify-between gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
											>
												<div>
													<div class="font-bold text-foreground">
														{member.name || '-'}
													</div>
												</div>
												<StayStatusChip
													status={member.status}
													detail={member.shelter_name || null}
													size="sm"
												/>
											</div>
										{/each}
									</div>
								</details>
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
				class="rounded-2xl border border-dashed border-border bg-muted/50 p-12 text-center text-muted-foreground"
			>
				<div
					class="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-card p-4 shadow-sm"
				>
					<Search class="size-10 text-muted-foreground" />
				</div>
				<h3 class="mb-2 text-lg font-bold text-foreground/90">ไม่พบรายชื่อ</h3>
				<p class="text-sm">ไม่พบข้อมูลที่ตรงกับการค้นหา กรุณาตรวจสอบความถูกต้องอีกครั้ง</p>
			</div>
		{/if}
	{:else}
		<div
			class="rounded-2xl border border-dashed border-border bg-muted/50 p-12 text-center text-muted-foreground"
		>
			<div
				class="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-card p-4 shadow-sm"
			>
				<Search class="size-10 text-muted-foreground" />
			</div>
			<h3 class="mb-2 text-lg font-bold text-foreground/90">เริ่มการค้นหา</h3>
			<p class="text-sm">
				พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน เพื่อทำการสืบค้นข้อมูล
			</p>
		</div>
	{/if}
</PublicPageShell>
