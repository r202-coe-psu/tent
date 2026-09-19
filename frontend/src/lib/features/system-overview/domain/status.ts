export type PreRegStatusInfo = {
	label: string;
	className: string;
	dotColor: string;
	isEntered: boolean;
	description: string;
};

export function getPreRegStatusInfo(
	stayStatus: string | null | undefined,
	queueStatus: string | null | undefined,
	hasShelter: boolean
): PreRegStatusInfo {
	const raw = (stayStatus || queueStatus?.split('@')[0] || '').trim().toLowerCase();

	if (raw === 'active' || raw === 'checked_in') {
		return {
			label: 'เข้าศูนย์แล้ว (อยู่ในศูนย์)',
			className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
			dotColor: 'bg-emerald-500',
			isEntered: true,
			description: 'ผู้พักพิงรายงานตัวและกำลังพักอยู่ในศูนย์'
		};
	}

	if (raw === 'room_confirmed') {
		return {
			label: 'เข้าศูนย์แล้ว (จัดห้องแล้ว)',
			className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
			dotColor: 'bg-emerald-600',
			isEntered: true,
			description: 'ผู้พักพิงเข้าพักและยืนยันการจัดห้อง/โซนเรียบร้อย'
		};
	}

	if (raw === 'arriving') {
		return {
			label: 'กำลังรายงานตัว',
			className: 'border-amber-200 bg-amber-50 text-amber-700',
			dotColor: 'bg-amber-500',
			isEntered: false,
			description: 'ผู้พักพิงกำลังเดินทางหรือรอรายงานตัวเข้าศูนย์'
		};
	}

	if (raw === 'temporary_leave') {
		return {
			label: 'ออกชั่วคราว',
			className: 'border-amber-200 bg-amber-50 text-amber-800',
			dotColor: 'bg-amber-500',
			isEntered: true,
			description: 'ผู้พักพิงได้รับอนุญาตออกนอกศูนย์ชั่วคราว'
		};
	}

	if (raw === 'checked_out') {
		return {
			label: 'ออกจากศูนย์แล้ว',
			className: 'border-slate-200 bg-slate-100 text-slate-600',
			dotColor: 'bg-slate-400',
			isEntered: true,
			description: 'ผู้พักพิงเช็คเอาต์ออกจากศูนย์แล้ว'
		};
	}

	if (raw === 'transferred') {
		return {
			label: 'ย้ายศูนย์แล้ว',
			className: 'border-purple-200 bg-purple-50 text-purple-700',
			dotColor: 'bg-purple-500',
			isEntered: true,
			description: 'ส่งตัวย้ายไปศูนย์พักพิงอื่นแล้ว'
		};
	}

	if (raw === 'deceased') {
		return {
			label: 'เสียชีวิต',
			className: 'border-zinc-200 bg-zinc-100 text-zinc-700',
			dotColor: 'bg-zinc-500',
			isEntered: true,
			description: 'เสียชีวิต'
		};
	}

	if (raw === 'cancelled') {
		return {
			label: 'ยกเลิก',
			className: 'border-rose-200 bg-rose-50 text-rose-700',
			dotColor: 'bg-rose-500',
			isEntered: false,
			description: 'รายการลงทะเบียนถูกยกเลิก'
		};
	}

	if (raw === 'pre_registered' || hasShelter) {
		if (hasShelter) {
			return {
				label: 'รอเข้าศูนย์ (ผูกศูนย์แล้ว)',
				className: 'border-sky-200 bg-sky-50 text-sky-700',
				dotColor: 'bg-sky-500',
				isEntered: false,
				description: 'ลงทะเบียนล่วงหน้าและระบุศูนย์เป้าหมายแล้ว รอเดินทางมาเข้าศูนย์'
			};
		}
	}

	return {
		label: 'ยังไม่ผูกศูนย์',
		className: 'border-slate-200 bg-slate-100 text-slate-600',
		dotColor: 'bg-slate-400',
		isEntered: false,
		description: 'ลงทะเบียนล่วงหน้าระดับส่วนกลาง ยังไม่ได้จัดสรรหรือระบุศูนย์พักพิง'
	};
}
