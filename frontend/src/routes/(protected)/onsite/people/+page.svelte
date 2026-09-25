<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import UserPlus from '@lucide/svelte/icons/user-plus';

	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';

	import {
		formatPersonName,
		lookupFederatedByScanCode,
		Station1IntakeSearch,
		Station1EvacueeQueue,
		goToEvacueeProfile,
		goToEvacueeReportIn,
		openEvacueeRow,
		type Evacuee
	} from '$lib/features/people';
	import {
		ClaimDialog,
		type UnassignedRegistrationSearchHit
	} from '$lib/features/unassigned-registration';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		canAccessMedicalScreening,
		canAccessZoning,
		canAccessUnassignedRegistrationQueue
	} from '$lib/auth/roles';

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const queryClient = useQueryClient();

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const roles = $derived(authStore.user?.roles ?? []);
	const canMedical = $derived(canAccessMedicalScreening(roles) && enableMedical);
	const canZoning = $derived(canAccessZoning(roles));
	const canAccessUnassignedQueue = $derived(
		canAccessUnassignedRegistrationQueue(
			roles,
			shelterStore.selectedShelterCode ?? getShelterCode()
		)
	);

	let searchQuery = $state('');
	let showCameraModal = $state(false);
	let cameraError = $state<string | null>(null);
	/** Shared with Station1IntakeSearch — hide header new-reg while hard-gate locks. */
	let newRegistrationLocked = $state(false);
	let claimOpen = $state(false);
	let claimHit = $state<UnassignedRegistrationSearchHit | null>(null);
	let lookupInFlight = $state(false);

	/** Origin path so the evacuee profile can offer a correct back link. */
	const listOrigin = $derived(`${page.url.pathname}${page.url.search}`);

	function goReportIn(evacuee: Evacuee) {
		goToEvacueeReportIn(evacuee);
	}

	function goProfile(evacuee: Evacuee) {
		goToEvacueeProfile(evacuee, listOrigin);
	}

	/** Row click — report-in for `pre_registered`, profile for every other status. */
	function handleOpenRow(evacuee: Evacuee) {
		openEvacueeRow(evacuee, listOrigin);
	}

	function goMedical(evacuee: Evacuee) {
		goto(
			resolve(`/onsite/medical-screening/${evacuee._id}` as `/onsite/medical-screening/${string}`)
		);
	}

	function goZoning(evacuee: Evacuee) {
		goto(resolve(`/onsite/zoning/${evacuee._id}` as `/onsite/zoning/${string}`));
	}

	async function handleCodeInput(raw: string) {
		if (lookupInFlight) return;
		lookupInFlight = true;
		try {
			const result = await lookupFederatedByScanCode(queryClient, raw);
			if (!result) {
				// If not an exact QR/barcode payload, put into search bar to search federated by text
				searchQuery = raw;
				showCameraModal = false;
				toast.info(`ค้นหา: ${raw}`);
				return;
			}
			showCameraModal = false;
			if (result.source === 'couch') {
				toast.success(`พบ: ${formatPersonName(result.evacuee)}`);
				handleOpenRow(result.evacuee);
				return;
			}
			toast.success('พบคิวลงทะเบียนล่วงหน้า (คิวกลาง)');
			claimHit = result.hit;
			claimOpen = true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ค้นหาจากรหัสที่สแกนไม่สำเร็จ');
		} finally {
			lookupInFlight = false;
		}
	}

	function cameraAttachment(node: HTMLDivElement) {
		const html5QrCode = new Html5Qrcode(node.id);
		cameraError = null;
		html5QrCode
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const minDimension = Math.min(width, height);
						const size = Math.floor(minDimension * 0.7);
						return { width: size, height: size };
					}
				},
				(decodedText) => {
					if (decodedText) {
						if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
						handleCodeInput(decodedText);
					}
				},
				() => {}
			)
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้';
			});
		return () => {
			if (html5QrCode.isScanning) html5QrCode.stop().catch(() => {});
		};
	}
</script>

<svelte:head>
	<title>ทะเบียนผู้ประสบภัย (Station 1) | SmartShelter</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
	<!-- 1. Header Bar -->
	<header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<a
				href={resolve('/onsite')}
				class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50"
				aria-label="กลับหน้าหลักระบบส่วนหน้า"
			>
				<ArrowLeft class="size-4" />
			</a>
			<div>
				<div class="flex items-center gap-2">
					<ClipboardList class="size-6 text-[#0A2647]" />
					<h1 class="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
						ทะเบียนผู้ประสบภัย
					</h1>
					<Badge variant="outline" class="border-blue-200 bg-blue-50 font-semibold text-blue-900">
						Station 1
					</Badge>
				</div>
				<p class="mt-0.5 text-xs text-slate-500">
					Registration Desk — จุดรับรายงานตัวผู้จองล่วงหน้าและรับลงทะเบียนหน้างาน (Walk-in)
				</p>
			</div>
		</div>
		{#if !newRegistrationLocked}
			<Button
				href={resolve('/onsite/people/new')}
				class="h-11 gap-2 rounded-xl bg-[#0A2647] font-semibold text-white shadow-xs hover:bg-[#051930]"
			>
				<UserPlus class="size-4" />
				<span>+ ลงทะเบียน Walk-in</span>
			</Button>
		{/if}
	</header>

	<!-- 2. Unified Smart Search & Scan Bar (Omnibox with Anti-dupe) -->
	<Card.Root class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<label for="station1-search-input" class="text-sm font-semibold text-slate-800">
				ค้นหาหรือสแกนก่อนลงทะเบียน (ตรวจซ้ำในศูนย์นี้และคิวกลาง)
			</label>
			<span class="text-xs text-slate-500">
				พิมพ์ชื่อ, เลขบัตร 13 หลัก, เบอร์โทร หรือใช้เครื่องสแกนบาร์โค้ด
			</span>
		</div>
		<Station1IntakeSearch
			bind:query={searchQuery}
			canClaimPool={canAccessUnassignedQueue}
			onNewRegistrationLockedChange={(locked) => (newRegistrationLocked = locked)}
			onScanClick={() => (showCameraModal = true)}
			onCodeEnter={handleCodeInput}
		/>
	</Card.Root>

	<!-- 3. Queue Summary + Workflow Tabs (shared with /onsite/search-edit) -->
	<Station1EvacueeQueue
		{enableMedical}
		{canMedical}
		{canZoning}
		filterQuery={searchQuery}
		onOpenRow={handleOpenRow}
		onReportIn={goReportIn}
		onProfile={goProfile}
		onGoMedical={goMedical}
		onGoZoning={goZoning}
	/>
</div>

<!-- Camera QR Scanner Modal -->
<Dialog.Root bind:open={showCameraModal}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>สแกน Person QR</Dialog.Title>
		</Dialog.Header>
		{#if cameraError}
			<p class="text-sm text-destructive">{cameraError}</p>
		{:else if showCameraModal}
			<div
				id="station1-qr-reader"
				class="overflow-hidden rounded-lg"
				{@attach cameraAttachment}
			></div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Central Pool Claim Dialog -->
<ClaimDialog
	bind:open={claimOpen}
	bind:hit={claimHit}
	shelterCode={shelterStore.selectedShelterCode ?? getShelterCode()}
/>
