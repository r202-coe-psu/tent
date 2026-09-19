<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { canAccessMedicalScreening, canAccessZoning } from '$lib/auth/roles';
	import {
		Station1EvacueeQueue,
		goToEvacueeProfile,
		goToEvacueeReportIn,
		openEvacueeRow,
		type Evacuee
	} from '$lib/features/people';
	import EvacueeQrSearchModal from './evacuee-qr-search-modal.svelte';

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const roles = $derived(authStore.user?.roles ?? []);
	const canMedical = $derived(canAccessMedicalScreening(roles) && enableMedical);
	const canZoning = $derived(canAccessZoning(roles));

	let queryText = $state('');
	let showQrModal = $state(false);

	/** Origin path so the evacuee profile can offer a correct back link. */
	const listOrigin = $derived(`${page.url.pathname}${page.url.search}`);

	function submitSearch() {
		const query = queryText.trim();
		if (!query) return;
		const resultsPath = resolve('/onsite/search-edit/results');
		goto(`${resultsPath}?q=${encodeURIComponent(query)}`);
	}

	function viewEvacuee(id: string) {
		const from = resolve('/onsite/search-edit');
		goto(resolve(`/onsite/people/evacuee-profile-view/${id}?from=${encodeURIComponent(from)}`));
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
</script>

<svelte:head>
	<title>ค้นหาและแก้ไขข้อมูล | SmartShelter Thailand</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
	<header class="flex items-center gap-4">
		<Button
			variant="secondary"
			size="icon"
			onclick={() => goto(resolve('/onsite'))}
			class="h-10 w-10 rounded-full"
			title="กลับ"
		>
			<ArrowLeft class="size-5" />
		</Button>
		<div>
			<h1 class="flex items-center gap-2 text-xl font-bold text-foreground md:text-2xl">
				<Search class="size-5 text-primary md:size-6" />
				ค้นหาและแก้ไขข้อมูลผู้พักพิง
			</h1>
			<p class="mt-0.5 text-xs font-semibold text-muted-foreground">Search &amp; Update</p>
		</div>
	</header>

	<Card.Root class="rounded-2xl border-border shadow-sm">
		<Card.Content class="px-5 py-5">
			<form
				onsubmit={(e) => {
					e.preventDefault();
					submitSearch();
				}}
				class="flex flex-col gap-3 sm:flex-row"
			>
				<div class="relative flex-1">
					<Search class="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="text"
						placeholder="ระบุเลขบัตรประชาชน / เบอร์โทรศัพท์ / ชื่อ-นามสกุล..."
						bind:value={queryText}
						class="h-12 rounded-xl bg-muted/50 pl-11 text-sm focus-visible:border-primary"
					/>
				</div>

				<Button
					type="submit"
					disabled={!queryText.trim()}
					class="h-12 shrink-0 gap-2 rounded-xl px-6 font-bold"
				>
					<Search class="size-4" />
					ค้นหาข้อมูล
				</Button>
				<Button
					type="button"
					variant="outline"
					onclick={() => (showQrModal = true)}
					class="h-12 shrink-0 gap-2 rounded-xl px-6 font-bold"
				>
					<ScanLine class="size-4" />
					สแกน QR Code ตั๋ว
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<Station1EvacueeQueue
		{enableMedical}
		{canMedical}
		{canZoning}
		onOpenRow={handleOpenRow}
		onReportIn={goToEvacueeReportIn}
		onProfile={goProfile}
		onGoMedical={goMedical}
		onGoZoning={goZoning}
	/>
</div>

<EvacueeQrSearchModal
	show={showQrModal}
	onClose={() => (showQrModal = false)}
	onFound={(evacueeId) => {
		showQrModal = false;
		viewEvacuee(evacueeId);
	}}
/>
