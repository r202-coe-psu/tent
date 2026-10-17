/** The sample label staff print from the kiosk home page to check the printer. */
export const TEST_PRINT_LABEL_NAME = 'ทดสอบการพิมพ์';

/**
 * Deliberately not an `evacuee:<ULID>` code: a test label that gets scanned at check-in is rejected
 * like any unknown QR instead of looking up a person.
 */
export const TEST_PRINT_QR_PAYLOAD = 'KIOSK-TEST-PRINT';
