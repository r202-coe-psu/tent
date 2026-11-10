import { footerLogoInputSchema, type FooterLogoInput } from '$lib/features/public-portal';
import type { PageServerLoad, Actions } from './$types';
import { authorizeUserWrite, ServiceError, serviceErrorStatus } from '$lib/server/couch-admin';
import {
	createFooterLogo,
	decodeFooterLogoFile,
	deleteFooterLogo,
	footerLogoRecords,
	moveFooterLogoTo,
	readPublicPortalConfig,
	setFooterLogoPublished,
	updateFooterLogo
} from '$lib/server/public-portal/footer-logos.server';
import { fail, error, type ActionFailure } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ request }) => {
	let caller;
	try {
		caller = await authorizeUserWrite(request.headers.get('cookie'));
	} catch (e) {
		if (e instanceof ServiceError) {
			throw error(e.code === 'UNAUTHENTICATED' ? 401 : 403, e.message);
		}
		throw error(500, 'Internal Server Error');
	}

	const existing = await readPublicPortalConfig();

	return {
		footerLogos: footerLogoRecords(existing),
		configRev: existing?._rev ?? '',
		canEditLogos: caller.isSA,
		title: 'โลโก้หน่วยงาน'
	};
};

type LogoActionResult = { logoMessage: string } | ActionFailure<{ logoError: string }>;

/** SA-only guard + ServiceError → `fail` mapping shared by the footer-logo actions (FR-7). */
async function logoAction(
	request: Request,
	run: (actor: string, form: FormData) => Promise<string>
): Promise<LogoActionResult> {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'ต้องเป็นผู้ดูแลระบบ (System Admin) เท่านั้น');
		}
		return { logoMessage: await run(caller.name, await request.formData()) };
	} catch (e) {
		if (e instanceof ServiceError) {
			return fail(serviceErrorStatus(e.code), { logoError: e.message });
		}
		console.error('Footer logo action failed:', e);
		return fail(500, { logoError: 'เกิดข้อผิดพลาดในการบันทึกโลโก้' });
	}
}

const text = (form: FormData, name: string): string => {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
};

function parseLogoInput(form: FormData): FooterLogoInput {
	const parsed = footerLogoInputSchema.safeParse({
		alt_th: text(form, 'alt_th'),
		alt_en: text(form, 'alt_en'),
		link_url: text(form, 'link_url'),
		is_published: text(form, 'is_published') === 'true'
	});
	if (!parsed.success) {
		throw new ServiceError(
			'VALIDATION',
			parsed.error.issues[0]?.message ?? 'ข้อมูลโลโก้ไม่ถูกต้อง'
		);
	}
	return parsed.data;
}

const newImage = (form: FormData) => {
	const file = form.get('image');
	return file instanceof File && file.size > 0 ? decodeFooterLogoFile(file) : null;
};

export const actions: Actions = {
	createLogo: ({ request }) =>
		logoAction(request, async (actor, form) => {
			const input = parseLogoInput(form);
			const image = newImage(form);
			if (!image) throw new ServiceError('VALIDATION', 'กรุณาเลือกรูปโลโก้');
			await createFooterLogo(actor, text(form, 'rev'), input, await image);
			return 'เพิ่มโลโก้เรียบร้อยแล้ว';
		}),

	updateLogo: ({ request }) =>
		logoAction(request, async (actor, form) => {
			const input = parseLogoInput(form);
			const image = newImage(form);
			await updateFooterLogo(
				actor,
				text(form, 'rev'),
				text(form, 'id'),
				input,
				image ? await image : null
			);
			return 'บันทึกโลโก้เรียบร้อยแล้ว';
		}),

	toggleLogo: ({ request }) =>
		logoAction(request, async (actor, form) => {
			const published = text(form, 'is_published') === 'true';
			await setFooterLogoPublished(actor, text(form, 'rev'), text(form, 'id'), published);
			return published ? 'แสดงโลโก้แล้ว' : 'ซ่อนโลโก้แล้ว';
		}),

	moveLogo: ({ request }) =>
		logoAction(request, async (actor, form) => {
			const direction = text(form, 'direction');
			if (direction !== 'up' && direction !== 'down') {
				throw new ServiceError('VALIDATION', 'ทิศทางไม่ถูกต้อง');
			}
			await moveFooterLogoTo(actor, text(form, 'rev'), text(form, 'id'), direction);
			return 'จัดลำดับโลโก้แล้ว';
		}),

	deleteLogo: ({ request }) =>
		logoAction(request, async (actor, form) => {
			await deleteFooterLogo(actor, text(form, 'rev'), text(form, 'id'));
			return 'ลบโลโก้แล้ว';
		})
};
