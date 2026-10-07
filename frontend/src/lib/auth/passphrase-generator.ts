/**
 * Curated list of 100 simple, memorable, distinct English words.
 * Used for generating human-friendly temporary passphrases for user resets.
 */
export const PASSPHRASE_WORDS: readonly string[] = [
	// Nature & Places (25)
	'Camp',
	'River',
	'Star',
	'Hill',
	'Tree',
	'Moon',
	'Sun',
	'Park',
	'Home',
	'Tent',
	'Lake',
	'Sky',
	'Field',
	'Cloud',
	'Rain',
	'Wind',
	'Rock',
	'Forest',
	'Ocean',
	'Valley',
	'Island',
	'Garden',
	'Bridge',
	'Tower',
	'Haven',
	// Animals & Wildlife (25)
	'Tiger',
	'Lion',
	'Bird',
	'Fish',
	'Deer',
	'Bear',
	'Wolf',
	'Eagle',
	'Hawk',
	'Duck',
	'Swan',
	'Horse',
	'Panda',
	'Otter',
	'Fox',
	'Seal',
	'Whale',
	'Dolphin',
	'Turtle',
	'Rabbit',
	'Falcon',
	'Koala',
	'Robin',
	'Gecko',
	'Badger',
	// Objects & Helpers (25)
	'Book',
	'Door',
	'Desk',
	'Boat',
	'Card',
	'Lamp',
	'Ring',
	'Bell',
	'Clock',
	'Flag',
	'Ship',
	'Wheel',
	'Drum',
	'Key',
	'Lock',
	'Shield',
	'Anchor',
	'Beacon',
	'Compass',
	'Torch',
	'Banner',
	'Helmet',
	'Map',
	'Chest',
	'Crown',
	// Positive Qualities & Colors (25)
	'Safe',
	'Good',
	'Fast',
	'Cool',
	'Blue',
	'Red',
	'Gold',
	'Warm',
	'Calm',
	'Bright',
	'Clean',
	'True',
	'Free',
	'Kind',
	'Wise',
	'Brave',
	'Pure',
	'Bold',
	'Glad',
	'Grand',
	'Noble',
	'Fresh',
	'Green',
	'Silver',
	'Strong'
] as const;

function capitalize(word: string): string {
	if (!word) return '';
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function getRandomItem<T>(arr: readonly T[]): T {
	const idx = Math.floor(Math.random() * arr.length);
	return arr[idx];
}

function getRandomNumber(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a memorable, human-friendly temporary passphrase complying with the Password Policy.
 * Format: `Word1-Word2-Digits!` (e.g. `Safe-Camp-2026!`)
 */
export function generateTemporaryPassphrase(): string {
	const word1 = capitalize(getRandomItem(PASSPHRASE_WORDS));
	let word2 = capitalize(getRandomItem(PASSPHRASE_WORDS));
	while (word2 === word1) {
		word2 = capitalize(getRandomItem(PASSPHRASE_WORDS));
	}
	const digits = getRandomNumber(1000, 9999);
	return `${word1}-${word2}-${digits}!`;
}
