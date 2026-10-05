import Fuse from 'fuse.js';
import type { ItemMaster } from './catalog';
import { isBaseUnitRow } from './item-barcode';

/** Collapse case and whitespace so "นม UHT 250" and "นมuht250" compare alike. */
function normalizeName(name: string): string {
	return name.replace(/\s+/g, '').toLowerCase();
}

const MIN_QUERY_LENGTH = 2;

type SimilarityDoc = { item: ItemMaster; norm: string };

/**
 * Active items whose name is close to `name`, nearest first — the "มีสินค้าชื่อคล้ายกัน"
 * warning before a new item is created. A name that contains, or is contained in, an
 * existing one always counts; the rest is fuzzy so typos and extra size words still hit.
 */
export function findSimilarItems(
	name: string,
	items: readonly ItemMaster[],
	options: { limit?: number } = {}
): ItemMaster[] {
	const limit = options.limit ?? 3;
	const needle = normalizeName(name);
	if (needle.length < MIN_QUERY_LENGTH) return [];

	const docs: SimilarityDoc[] = items
		.filter((item) => !item.deactivated)
		.map((item) => ({ item, norm: normalizeName(item.name) }))
		.filter((doc) => doc.norm !== '');

	const contained = docs.filter(
		(doc) =>
			doc.norm.includes(needle) ||
			(doc.norm.length >= MIN_QUERY_LENGTH && needle.includes(doc.norm))
	);
	const seen = new Set(contained.map((doc) => doc.item._id));

	const fuse = new Fuse(docs, {
		keys: ['norm'],
		threshold: 0.35,
		ignoreLocation: true,
		includeScore: true
	});
	const fuzzy = fuse
		.search(needle)
		.filter((hit) => !seen.has(hit.item.item._id))
		.map((hit) => hit.item);

	// Containment first (closest in length), then fuzzy hits in score order.
	contained.sort(
		(a, b) => Math.abs(a.norm.length - needle.length) - Math.abs(b.norm.length - needle.length)
	);

	return [...contained, ...fuzzy].slice(0, limit).map((doc) => doc.item);
}

// ---------------------------------------------------------------- missing optional fields

const FUEL_ENERGY_CATEGORY_ID = 'item_category:fuel_energy';

/**
 * Thai labels of the optional fields an item still lacks — drives the
 * "ข้อมูลไม่ครบ" chip and the "ยังขาด" column. Only fields that apply to the
 * item's `type_class` are listed.
 */
export function missingOptionalFields(item: ItemMaster): string[] {
	const missing: string[] = [];
	const typeClass = item.type_class as ItemMaster['type_class'] | undefined;
	if (!typeClass) missing.push('ประเภท');

	if (!item.sku?.trim()) missing.push('SKU');

	if (typeClass !== 'EQUIPMENT') {
		const packRows = (item.conversions ?? []).filter(
			(c) => c.uom_name?.trim() && !isBaseUnitRow(c, item.base_unit ?? '')
		);
		if (packRows.length === 0) missing.push('ขนาดบรรจุ');
	}

	if (typeClass === 'CONSUMABLE') {
		if (item.shelf_life_days == null) missing.push('อายุเก็บรักษา');
		if (!item.storage_type) missing.push('การเก็บรักษา');
		if (!item.allergens?.trim() && item.category !== FUEL_ENERGY_CATEGORY_ID) {
			missing.push('สารก่อภูมิแพ้');
		}
	}
	if (typeClass === 'CONSUMABLE' || typeClass === 'DURABLE') {
		if (!item.target_gender && !item.age_group) missing.push('กลุ่มผู้รับ');
	}

	return missing;
}
