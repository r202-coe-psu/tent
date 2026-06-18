<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Search from '@lucide/svelte/icons/search';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import FileText from '@lucide/svelte/icons/file-text';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Heart from '@lucide/svelte/icons/heart';
	import Info from '@lucide/svelte/icons/info';
	import Compass from '@lucide/svelte/icons/compass';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Ambulance from '@lucide/svelte/icons/ambulance';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Truck from '@lucide/svelte/icons/truck';

	let activeTab = $state('register'); // register | portal | needs
</script>

<svelte:head>
	<title>ระบบงานข้อมูลอาสาสมัคร — Smart Shelter</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-8">
	<!-- Top Banner -->
	<div class="relative mb-8 overflow-hidden rounded-3xl bg-primary-dark text-white p-6 md:p-10 shadow-lg">
		<div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
			<div class="max-w-2xl">
				<span class="inline-block rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-black tracking-wider text-slate-300 uppercase mb-3">
					# RESCUE VOLUNTEER PLATFORM
				</span>
				<h1 class="text-xl md:text-2xl font-black tracking-tight text-white">
					ระบบงานข้อมูลอาสาสมัครร่วมบูรณาการภัยพิบัติ
				</h1>
				<p class="mt-2 text-xs leading-relaxed text-slate-300">
					เชื่อมประสานความดี ขจัดปัญหาร่วมกระจุกตัว ด้วยการคัดกรองทักษะ (Skill Matching) ออกรหัสลงทะเบียน (Role Card) ปฏิบัติอาสา และติดตามสวัสดิการตามมาตรฐาน Sphere
				</p>
			</div>

			<!-- Stats -->
			<div class="flex gap-4 shrink-0">
				<div class="rounded-2xl bg-white/5 border border-white/10 p-4 text-center min-w-28">
					<div class="text-[10px] text-slate-400 font-bold">ลงทะเบียนแล้ว</div>
					<div class="mt-1 text-xl font-black text-white">6 คน</div>
				</div>
				<div class="rounded-2xl bg-chart-2/15 border border-chart-2/30 p-4 text-center min-w-28">
					<div class="text-[10px] text-chart-2 font-bold">เข้าพื้นที่ทำงาน</div>
					<div class="mt-1 text-xl font-black text-chart-2">5 คน</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Tab Bar Navigation -->
	<div class="mb-8 flex justify-start border-b border-border">
		<div class="inline-flex rounded-t-xl bg-muted/30 p-1 border-t border-x border-border/50">
			<button 
				onclick={() => activeTab = 'register'}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab === 'register' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
			>
				<UserPlus class="h-3.5 w-3.5" />
				รวมสมัครพลังอาสา
			</button>
			<button 
				onclick={() => activeTab = 'portal'}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab === 'portal' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
			>
				<QrCode class="h-3.5 w-3.5" />
				พอร์ทัล & บัตรงานอาสา
			</button>
			<button 
				onclick={() => activeTab = 'needs'}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab === 'needs' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
			>
				<ClipboardList class="h-3.5 w-3.5" />
				ประกาศความต้องการกำลังพล
			</button>
		</div>
	</div>

	<!-- TAB 1: รวมสมัครพลังอาสา -->
	{#if activeTab === 'register'}
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<!-- Form area -->
			<div class="lg:col-span-2">
				<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-2xs">
					<h2 class="text-base font-bold text-foreground">1. ลงทะเบียนร่วมเป็นกำลังอาสา</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						เมื่อผ่านขบวนลงทะเบียน ระบบจะออกรหัสประจำตัวอาสาสำหรับใช้เช็คอิน และแจกจ่ายบัตรงาน Role Card หน้าจุดในทันที
					</p>

					<form onsubmit={(e) => e.preventDefault()} class="mt-6 space-y-5">
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-1.5">
								<label class="text-xs font-bold text-foreground" for="fullname">ชื่อ-นามสกุล ของท่าน</label>
								<input id="fullname" type="text" placeholder="ระบุชื่อจริง นามสกุล" class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground" />
							</div>
							<div class="flex flex-col gap-1.5">
								<label class="text-xs font-bold text-foreground" for="emergency-phone">เบอร์ติดต่อกรณีฉุกเฉิน</label>
								<input id="emergency-phone" type="text" placeholder="08X-XXX-XXXX" class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground" />
							</div>
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="text-xs font-bold text-foreground" for="shelter">ศูนย์พักพิงที่ต้องการเข้าช่วย</label>
							<select id="shelter" class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary">
								<option>ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
								<option>ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
							</select>
						</div>
						
						<div class="flex flex-col gap-1.5">
							<label class="text-xs font-bold text-foreground" for="shift">กะการเข้าร่วมช่วยเหลือ (Shift)</label>
							<select id="shift" class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary">
								<option>กะเช้า (08:00 - 16:00)</option>
								<option>กะบ่าย (16:00 - 00:00)</option>
								<option>กะดึก (00:00 - 08:00)</option>
							</select>
						</div>

						<!-- Skills checklist with visual boxes -->
						<div>
							<span class="text-xs font-bold text-foreground block mb-3">ทักษะที่เกี่ยวข้องของตัวท่าน (รับเฉพาะเกณฑ์คัดกรอง)</span>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<label class="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 hover:bg-muted/10 cursor-pointer select-none">
									<input type="checkbox" class="mt-1 rounded border-border text-primary focus:ring-primary h-4.5 w-4.5" />
									<div>
										<span class="text-xs font-bold text-foreground flex items-center gap-1.5">
											<ChefHat class="h-3.5 w-3.5 text-orange-500" />
											ประกอบอาหาร (Cooking)
										</span>
										<p class="mt-1 text-[10px] text-muted-foreground">ศูนย์ขาดแคลนกำลังทำอาหารจำนวนมาก</p>
									</div>
								</label>

								<label class="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 hover:bg-muted/10 cursor-pointer select-none">
									<input type="checkbox" class="mt-1 rounded border-border text-primary focus:ring-primary h-4.5 w-4.5" />
									<div>
										<span class="text-xs font-bold text-foreground flex items-center gap-1.5">
											<Ambulance class="h-3.5 w-3.5 text-red-500" />
											การแพทย์/ปฐมพยาบาล (Medical)
										</span>
										<p class="mt-1 text-[10px] text-muted-foreground">ต้องการพยาบาลและผู้ดูแลผู้ป่วยไข้</p>
									</div>
								</label>

								<label class="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 hover:bg-muted/10 cursor-pointer select-none">
									<input type="checkbox" class="mt-1 rounded border-border text-primary focus:ring-primary h-4.5 w-4.5" />
									<div>
										<span class="text-xs font-bold text-foreground flex items-center gap-1.5">
											<FileText class="h-3.5 w-3.5 text-blue-500" />
											คัดกรองประวัติ (Screening)
										</span>
										<p class="mt-1 text-[10px] text-muted-foreground">บันทึกข้อมูลหน้าจุดลงทะเบียนร่วมกับระบบคลาวด์</p>
									</div>
								</label>

								<label class="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 hover:bg-muted/10 cursor-pointer select-none">
									<input type="checkbox" class="mt-1 rounded border-border text-primary focus:ring-primary h-4.5 w-4.5" />
									<div>
										<span class="text-xs font-bold text-foreground flex items-center gap-1.5">
											<Truck class="h-3.5 w-3.5 text-amber-600" />
											ขนย้ายสิ่งของ (Lifting/Logistics)
										</span>
										<p class="mt-1 text-[10px] text-muted-foreground">ใช้แรงจัดขนของ ยานพาหนะ อุปกรณ์ช่วยเหลือภัยน้ำท่วม</p>
									</div>
								</label>
							</div>
						</div>

						<button type="submit" class="flex w-full items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-dark text-white font-bold text-xs py-3.5 transition-colors cursor-pointer shadow-sm">
							+ ยื่นส่งแบบฟอร์มอาสาสมัคร
						</button>
					</form>
				</div>
			</div>

			<!-- Sidebar -->
			<div class="flex flex-col gap-5">
				<!-- Welfare list -->
				<div class="rounded-3xl border border-border bg-card p-5 shadow-2xs">
					<h3 class="text-sm font-bold text-foreground flex items-center gap-1.5">
						<Heart class="h-4.5 w-4.5 text-danger" />
						คุณจะได้รับสวัสดิการอะไรบ้าง?
					</h3>
					<p class="mt-2 text-[10px] leading-relaxed text-muted-foreground">
						โครงการยึดถือมาตรฐานสากลในการดูแลช่วยเหลือและสนับสนุนปัจจัยสี่ให้กับอาสาสมัครส่วนหน้าระหว่างปฏิบัติงาน:
					</p>

					<div class="mt-4 space-y-3.5">
						<div class="flex gap-2.5">
							<span class="text-sm">🍱</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">โภชนาการประจำมื้อ</h4>
								<p class="text-[9px] text-muted-foreground">รับสิทธิ์อาหารหลักกล่องฟรีตามที่จองลงกะงาน</p>
							</div>
						</div>
						<div class="flex gap-2.5">
							<span class="text-sm">💧</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">น้ำดื่มผลิตสะอาด</h4>
								<p class="text-[9px] text-muted-foreground">ได้รับการจัดสรรน้ำขวดพกพาปฏิบัติงานอย่างต่อเนื่อง</p>
							</div>
						</div>
						<div class="flex gap-2.5">
							<span class="text-sm">🦺</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">ชุดเครื่องแต่งกาย & อุปกรณ์ PPE</h4>
								<p class="text-[9px] text-muted-foreground">เสื้อสะท้อนแสง หน้ากาก ถุงมือ ปฐมพยาบาลครบครัน</p>
							</div>
						</div>
					</div>
				</div>

				<!-- Safety Info -->
				<div class="rounded-3xl border border-warning-border/40 bg-amber-500/5 p-5">
					<h4 class="flex items-center gap-1.5 text-xs font-bold text-amber-700">
						<Info class="h-4 w-4 text-amber-600" />
						ข้อทดสอบความปลอดภัย
					</h4>
					<p class="mt-2 text-[10.5px] leading-relaxed text-slate-500">
						อาสาสมัครทุกคนจะต้องปฏิบัติตามแผนคำสั่งและคำแนะนำของหัวหน้าเวรศูนย์พักพิงหลัก หากพบอาการไม่สบาย มีไข้ หรือเกิดอุบัติเหตุแจ้งทีมแพทย์ส่วนหลังทันที!
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- TAB 2: พอร์ทัล & บัตรงานอาสา -->
	{#if activeTab === 'portal'}
		<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs max-w-2xl mx-auto">
			<h2 class="text-base font-bold text-foreground flex items-center gap-2">
				<UserCheck class="h-5 w-5 text-primary" />
				พอร์ทัลอาสาสมัคร (My Portal)
			</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				เข้าสู่ระบบด้วยรหัสอาสา หรือค้นหาจากชื่อเพื่อดูข้อมูล Role Card
			</p>

			<!-- Search Bar -->
			<div class="mt-6 flex gap-3">
				<div class="relative flex-1">
					<input 
						type="text" 
						placeholder="ระบุรหัส V-1025 หรือชื่อ"
						class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 pl-10 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary focus:border-primary"
					/>
					<Search class="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
				</div>
				<button class="rounded-xl bg-primary hover:bg-primary-dark text-white font-bold text-xs px-5 py-3 shadow-sm transition-colors">
					ค้นหาประวัติ
				</button>
			</div>

			<!-- Search Placeholder Card -->
			<div class="mt-8 rounded-2xl border border-dashed border-border bg-muted/10 p-10 text-center">
				<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 border border-slate-200 mb-4">
					<QrCode class="h-6 w-6" />
				</div>
				<h4 class="text-sm font-bold text-foreground">กรุณาค้นหาเพื่อเข้าสู่บัตรประจำตัว</h4>
				<p class="mt-1.5 text-xs text-muted-foreground max-w-sm mx-auto">
					ใช้รหัส V-XXXX หรือชื่อ-นามสกุลจริง เปิดดู Role Card รับทราบหน้าที่ และรายงานตัวแบบเรียลไทม์
				</p>
			</div>
		</div>
	{/if}

	<!-- TAB 3: ประกาศความต้องการกำลังพล -->
	{#if activeTab === 'needs'}
		<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs">
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-6 mb-6">
				<div>
					<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
						<ClipboardList class="h-5 w-5 text-primary" />
						ประกาศความต้องการกำลังพล
					</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						ประกาศรับสมัครจิตอาสาตามความต้องการของแต่ละศูนย์พักพิง
					</p>
				</div>
				<!-- Search -->
				<div class="relative w-full md:w-80">
					<input 
						type="text" 
						placeholder="ค้นหาชื่อศูนย์ หรือ อปท."
						class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 pl-9 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
					/>
					<Search class="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
				</div>
			</div>

			<!-- List -->
			<div class="flex flex-col gap-6">
				<!-- Shelter Row 1 -->
				<div class="rounded-2xl border border-border p-5 bg-muted/5">
					<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-border/50 pb-4 mb-4">
						<div>
							<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</h3>
							<p class="text-[10px] text-muted-foreground mt-0.5">อปท. เทศบาลนครหาดใหญ่ | จำนวนผู้พักพิง 1/250 คน</p>
						</div>
						<span class="rounded-lg bg-danger-muted/30 text-danger px-3 py-1.5 text-xs font-bold shrink-0">
							ต้องการอาสาเพิ่ม 6 อัตรา
						</span>
					</div>

					<div class="text-xs font-bold text-foreground mb-3">ความต้องการทักษะเฉพาะด้าน:</div>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
						<div class="rounded-xl border border-border bg-card p-3 flex justify-between items-center text-xs">
							<span class="text-muted-foreground">• แม่ครัว/ทำอาหาร</span>
							<span class="font-bold text-foreground">ต้องการ: 2 คน</span>
						</div>
						<div class="rounded-xl border border-border bg-card p-3 flex justify-between items-center text-xs">
							<span class="text-muted-foreground">• ทีมแพทย์/พยาบาล</span>
							<span class="font-bold text-foreground">ต้องการ: 0 คน</span>
						</div>
						<div class="rounded-xl border border-border bg-card p-3 flex justify-between items-center text-xs">
							<span class="text-muted-foreground">• ทีมคัดกรองประวัติ</span>
							<span class="font-bold text-foreground">ต้องการ: 1 คน</span>
						</div>
					</div>

					<button onclick={() => activeTab = 'register'} class="flex w-full items-center justify-center rounded-xl bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-xs py-3 shadow-sm transition-colors cursor-pointer">
						สมัครเป็นอาสาสมัครประจำศูนย์นี้
					</button>
				</div>

				<!-- Shelter Row 2 -->
				<div class="rounded-2xl border border-border p-5 bg-muted/5">
					<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-border/50 pb-4 mb-4">
						<div>
							<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</h3>
							<p class="text-[10px] text-muted-foreground mt-0.5">อปท. เทศบาลเมืองคลองแห | จำนวนผู้พักพิง 1/180 คน</p>
						</div>
						<span class="rounded-lg bg-danger-muted/30 text-danger px-3 py-1.5 text-xs font-bold shrink-0">
							ต้องการอาสาเพิ่ม 6 อัตรา
						</span>
					</div>

					<div class="text-xs font-bold text-foreground mb-3">ความต้องการทักษะเฉพาะด้าน:</div>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
						<div class="rounded-xl border border-border bg-card p-3 flex justify-between items-center text-xs">
							<span class="text-muted-foreground">• แม่ครัว/ทำอาหาร</span>
							<span class="font-bold text-foreground">ต้องการ: 4 คน</span>
						</div>
						<div class="rounded-xl border border-border bg-card p-3 flex justify-between items-center text-xs">
							<span class="text-muted-foreground">• ทีมแพทย์/พยาบาล</span>
							<span class="font-bold text-foreground">ต้องการ: 1 คน</span>
						</div>
						<div class="rounded-xl border border-border bg-card p-3 flex justify-between items-center text-xs">
							<span class="text-muted-foreground">• ทีมคัดกรองประวัติ</span>
							<span class="font-bold text-foreground">ต้องการ: 1 คน</span>
						</div>
					</div>

					<button onclick={() => activeTab = 'register'} class="flex w-full items-center justify-center rounded-xl bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-xs py-3 shadow-sm transition-colors cursor-pointer">
						สมัครเป็นอาสาสมัครประจำศูนย์นี้
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
