/**
 * ThaiD Autofill Domain Model
 * Representation of citizen demographic data extracted from ThaiD (BORA DOPA)
 * used for rapid autofill in intake and pre-registration forms.
 */

export interface ThaiDAutofillAddress {
	address_no: string;
	village_no: string;
	subdistrict: string;
	district: string;
	province: string;
	postal_code: string;
}

export interface ThaiDAutofillProfile {
	id: string;
	roleLabel: string;
	person_id: string;
	first_name: string;
	last_name: string;
	nickname: string;
	gender: 'male' | 'female' | 'other';
	birth_year: number;
	age: number;
	phone: string | null;
	vulnerable_groups: string[];
	special_needs: string[];
	medical_conditions: string[];
	address: ThaiDAutofillAddress;
}

export const THAI_TITLES = [
	{ prefix: 'เด็กชาย', gender: 'male' as const },
	{ prefix: 'เด็กหญิง', gender: 'female' as const },
	{ prefix: 'ด.ช.', gender: 'male' as const },
	{ prefix: 'ด.ญ.', gender: 'female' as const },
	{ prefix: 'นางสาว', gender: 'female' as const },
	{ prefix: 'น.ส.', gender: 'female' as const },
	{ prefix: 'นาย', gender: 'male' as const },
	{ prefix: 'นาง', gender: 'female' as const }
] as const;

/**
 * Strips common Thai title prefixes (นาย, นาง, นางสาว, ด.ช., etc.)
 * and infers gender if not already determined.
 */
export function stripThaiTitle(rawText: string): {
	cleanedText: string;
	inferredGender?: 'male' | 'female';
} {
	const trimmed = rawText.trim();
	for (const t of THAI_TITLES) {
		if (trimmed.startsWith(t.prefix)) {
			return {
				cleanedText: trimmed.slice(t.prefix.length).trim(),
				inferredGender: t.gender
			};
		}
	}
	return { cleanedText: trimmed };
}
