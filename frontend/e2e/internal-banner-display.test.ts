import { test, expect, type Page } from '@playwright/test';

const TAGS = { tag: ['@regression', '@kiosk'] };

const INVALID_CODE_MESSAGE = 'รหัสไม่ถูกต้องหรือถูกเปลี่ยนแล้ว';
const EMPTY_FEED_MESSAGE = 'ยังไม่มีสื่อให้แสดง';

/** 1x1 transparent PNG: the slide images only need to load, not to look like anything. */
const PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

type FeedSlide = { id: string; title: string; duration_sec: number };

const slide = ({ id, title, duration_sec }: FeedSlide) => ({
	id,
	title,
	caption: null,
	duration_sec,
	image_url: `/mock-banner/${id}.png`
});

/** Answers the TV feed and the slide images; no CouchDB or FastAPI involved. */
async function mockFeed(page: Page, respond: { status: number; slides?: FeedSlide[] }) {
	await page.route('**/api/v1/kiosk/internal/*/banners*', (route) =>
		route.fulfill({
			status: respond.status,
			contentType: 'application/json',
			body: JSON.stringify(
				respond.status === 200
					? { banners: (respond.slides ?? []).map(slide), fetched_at: '2026-11-10T00:00:00.000Z' }
					: {}
			)
		})
	);
	await page.route('**/mock-banner/*.png', (route) =>
		route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
	);
}

/** Types the code on the TV keypad with the remote only: arrow keys move focus, Enter presses. */
async function typeCodeWithRemote(page: Page) {
	// Focus starts on "1". Path through the 3x4 grid (1 2 3 / 4 5 6 / 7 8 9 / ลบ 0 ตกลง):
	// 1 → 2 → 3 → down 6 → down 9 → down ตกลง → left 0  =  "123690"
	await expect(page.getByRole('button', { name: 'ตัวเลข 1' })).toBeFocused();
	const presses = [
		'Enter',
		'ArrowRight',
		'Enter',
		'ArrowRight',
		'Enter',
		'ArrowDown',
		'Enter',
		'ArrowDown',
		'Enter',
		'ArrowDown',
		'ArrowLeft',
		'Enter'
	];
	for (const key of presses) await page.keyboard.press(key);
}

test.describe('Internal banner display (/banner/[shelter]/internal)', () => {
	test(
		'opening /banner/SH1/internal without a code, typing 6 digits with arrow keys + Enter lands on ?c=<code> and plays the first slide',
		TAGS,
		async ({ page }) => {
			await mockFeed(page, {
				status: 200,
				slides: [
					{ id: 'b1', title: 'ประกาศ 1', duration_sec: 30 },
					{ id: 'b2', title: 'ประกาศ 2', duration_sec: 30 }
				]
			});

			await page.goto('/banner/SH1/internal');
			await typeCodeWithRemote(page);

			await expect(page).toHaveURL(/\/banner\/SH1\/internal\?c=123690$/);
			await expect(page.getByRole('img', { name: 'ประกาศ 1' })).toHaveAttribute(
				'src',
				'/mock-banner/b1.png'
			);
		}
	);

	test('the slideshow advances to the next slide after its duration', TAGS, async ({ page }) => {
		await mockFeed(page, {
			status: 200,
			slides: [
				{ id: 'b1', title: 'ประกาศ 1', duration_sec: 3 },
				{ id: 'b2', title: 'ประกาศ 2', duration_sec: 3 }
			]
		});

		await page.goto('/banner/SH1/internal?c=123456');
		await expect(page.getByRole('img', { name: 'ประกาศ 1' })).toBeVisible();

		await expect(page.getByRole('img', { name: 'ประกาศ 2' })).toHaveAttribute(
			'src',
			'/mock-banner/b2.png',
			{ timeout: 7_000 }
		);
	});

	test(
		`a 404 feed returns to the keypad with '${INVALID_CODE_MESSAGE}'`,
		TAGS,
		async ({ page }) => {
			await mockFeed(page, { status: 404 });

			await page.goto('/banner/SH1/internal?c=123456');

			await expect(page.getByText(INVALID_CODE_MESSAGE)).toBeVisible();
			await expect(page.getByRole('button', { name: 'ตัวเลข 1' })).toBeVisible();
			await expect(page).not.toHaveURL(/c=/);
		}
	);

	test(`an empty feed shows '${EMPTY_FEED_MESSAGE}'`, TAGS, async ({ page }) => {
		await mockFeed(page, { status: 200, slides: [] });

		await page.goto('/banner/SH1/internal?c=123456');

		await expect(page.getByText(EMPTY_FEED_MESSAGE)).toBeVisible();
	});

	test('the system banner is not shown on the TV screen', TAGS, async ({ page }) => {
		await mockFeed(page, {
			status: 200,
			slides: [{ id: 'b1', title: 'ประกาศ 1', duration_sec: 30 }]
		});
		await page.route('**/api/public/v1/system-banner', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ enabled: true, message: 'ระบบทดสอบ', variant: 'warning' })
			})
		);

		await page.goto('/banner/SH1/internal?c=123456');

		await expect(page.getByRole('img', { name: 'ประกาศ 1' })).toBeVisible();
		await page.waitForTimeout(500);
		await expect(page.getByText('ระบบทดสอบ')).toHaveCount(0);
	});
});
