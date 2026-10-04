import base64
import io
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

try:
    from smartcard.System import readers
    from smartcard.Exceptions import NoCardException, CardConnectionException
except ImportError:
    readers = None
    NoCardException = Exception
    CardConnectionException = Exception

logger = logging.getLogger(__name__)


# progress(phase, done, total): "data" counts the nine text fields, "photo" the 20 photo chunks.
ProgressCallback = Callable[[str, int, int], None]
DATA_FIELDS = 9
PHOTO_CHUNK_COUNT = 20


class ReaderLostError(RuntimeError):
    """The reader hardware vanished (USB unplugged). Unlike a card error it must reach the
    manager, which then drops the reader and waits for it again instead of showing a read error."""

# Thai Smart Card Applet APDU
SELECT = [0x00, 0xA4, 0x04, 0x00, 0x08]
THAI_CARD_AID = [0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01]

# APDU Commands
CMD_CID = [0x80, 0xB0, 0x00, 0x04, 0x02, 0x00, 0x0D]
CMD_THFULLNAME = [0x80, 0xB0, 0x00, 0x11, 0x02, 0x00, 0x64]
CMD_ENFULLNAME = [0x80, 0xB0, 0x00, 0x75, 0x02, 0x00, 0x64]
CMD_BIRTH = [0x80, 0xB0, 0x00, 0xD9, 0x02, 0x00, 0x08]
CMD_GENDER = [0x80, 0xB0, 0x00, 0xE1, 0x02, 0x00, 0x01]
CMD_ISSUER = [0x80, 0xB0, 0x00, 0xF6, 0x02, 0x00, 0x64]
CMD_ISSUE = [0x80, 0xB0, 0x01, 0x67, 0x02, 0x00, 0x08]
CMD_EXPIRE = [0x80, 0xB0, 0x01, 0x6F, 0x02, 0x00, 0x08]
CMD_ADDRESS = [0x80, 0xB0, 0x15, 0x79, 0x02, 0x00, 0x64]

# Photo Chunks (20 parts)
CMD_PHOTOS = [
    [0x80, 0xB0, 0x01, 0x7B, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x02, 0x7A, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x03, 0x79, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x04, 0x78, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x05, 0x77, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x06, 0x76, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x07, 0x75, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x08, 0x74, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x09, 0x73, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x0A, 0x72, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x0B, 0x71, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x0C, 0x70, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x0D, 0x6F, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x0E, 0x6E, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x0F, 0x6D, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x10, 0x6C, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x11, 0x6B, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x12, 0x6A, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x13, 0x69, 0x02, 0x00, 0xFF],
    [0x80, 0xB0, 0x14, 0x68, 0x02, 0x00, 0xFF],
]


class ThaiSmartCardReader:
    """Hardware driver interface for Thai National ID Smart Card Reader via PC/SC"""

    def __init__(self, reader_index: int = 0, connection: Any = None):
        """`connection` lets a subclass supply a non-PC/SC transport that offers the same
        connect() / getATR() / transmit() API; the APDU and decoding logic below is shared."""
        self.req_prefix = [0x00, 0xC0, 0x00, 0x00]
        self._progress: Optional[ProgressCallback] = None
        if connection is not None:
            self.reader = None
            self.connection = connection
            return

        if readers is None:
            raise RuntimeError("pyscard is not installed. Please install pyscard and pcscd.")

        available_readers = readers()
        if not available_readers:
            raise RuntimeError("No Smart Card Reader detected. Please connect a USB reader.")

        if reader_index >= len(available_readers):
            raise IndexError(f"Reader index {reader_index} out of range (found {len(available_readers)} readers)")

        self.reader = available_readers[reader_index]
        self.connection = self.reader.createConnection()
        logger.info(f"Initialized Smart Card Reader: {self.reader}")

    def connect(self) -> bool:
        """Establish connection with the inserted smart card and select Thai card applet"""
        try:
            self.connection.connect()
            atr = self.connection.getATR()

            if len(atr) >= 2 and atr[0] == 0x3B and atr[1] == 0x67:
                self.req_prefix = [0x00, 0xC0, 0x00, 0x01]
            else:
                self.req_prefix = [0x00, 0xC0, 0x00, 0x00]

            # Select Thai Card Applet
            data, sw1, sw2 = self.connection.transmit(SELECT + THAI_CARD_AID)
            logger.debug(f"Select Applet Response: {sw1:02X} {sw2:02X}")
            return True
        except ReaderLostError:
            # Must precede NoCardException: without pyscard that name is an alias of Exception.
            raise
        except NoCardException:
            logger.debug("No card inserted.")
            return False
        except Exception as e:
            logger.warning(f"Connection error: {e}")
            return False

    def is_card_inserted(self) -> bool:
        """Check whether a card is currently inserted in the reader"""
        try:
            self.connection.connect()
            return True
        except NoCardException:
            return False
        except Exception:
            return False

    def _report(self, phase: str, done: int, total: int) -> None:
        """Tell whoever is showing the read how far it is. A UI callback must never break the read."""
        if self._progress is None:
            return
        try:
            self._progress(phase, done, total)
        except Exception:
            logger.debug("Read progress callback failed", exc_info=True)

    def decode_tis620(self, data: List[int]) -> str:
        """Decode byte array from TIS-620 encoding (standard for Thai Smart Card)"""
        try:
            return bytes(data).decode("tis-620").strip()
        except Exception as e:
            logger.error(f"Decode error: {e}")
            return ""

    def transmit_cmd(self, cmd: List[int]) -> List[int]:
        """Send APDU command and retrieve data response"""
        data, sw1, sw2 = self.connection.transmit(cmd)
        data, sw1, sw2 = self.connection.transmit(self.req_prefix + [cmd[-1]])
        return data

    def get_citizen_id(self) -> str:
        data = self.transmit_cmd(CMD_CID)
        return self.decode_tis620(data).replace("\x00", "").strip()

    def get_thai_name_parts(self) -> List[str]:
        raw = self.decode_tis620(self.transmit_cmd(CMD_THFULLNAME))
        return raw.split("#")

    def get_english_name_parts(self) -> List[str]:
        raw = self.decode_tis620(self.transmit_cmd(CMD_ENFULLNAME))
        return raw.split("#")

    def get_date_of_birth(self) -> str:
        return self.decode_tis620(self.transmit_cmd(CMD_BIRTH))

    def get_gender(self) -> str:
        val = self.decode_tis620(self.transmit_cmd(CMD_GENDER))
        if val == "1":
            return "male"
        elif val == "2":
            return "female"
        return "other"

    def get_address_parts(self) -> List[str]:
        raw = self.decode_tis620(self.transmit_cmd(CMD_ADDRESS))
        return raw.split("#")

    def get_issuer(self) -> str:
        return self.decode_tis620(self.transmit_cmd(CMD_ISSUER))

    def get_issue_date(self) -> str:
        return self.decode_tis620(self.transmit_cmd(CMD_ISSUE))

    def get_expire_date(self) -> str:
        return self.decode_tis620(self.transmit_cmd(CMD_EXPIRE))

    def get_photo_bytes(self) -> Optional[bytes]:
        """Extract and assemble 20 chunks of JPEG photo bytes from the smart card"""
        data = []
        try:
            for number, chunk_cmd in enumerate(CMD_PHOTOS, start=1):
                response, sw1, sw2 = self.connection.transmit(chunk_cmd)
                if sw1 == 0x61:
                    get_resp_cmd = [0x00, 0xC0, 0x00, 0x00, sw2]
                    chunk_data, _, _ = self.connection.transmit(get_resp_cmd)
                    data.extend(chunk_data)
                self._report("photo", number, PHOTO_CHUNK_COUNT)

            if data:
                return bytes(bytearray(data))
            return None
        except ReaderLostError:
            raise
        except Exception as e:
            logger.error(f"Error extracting photo: {e}")
            return None

    def read_citizen_id(self) -> str:
        """Read only the 13-digit citizen ID — skips names, address and the 20-chunk photo"""
        if not self.connect():
            raise RuntimeError("Failed to connect to smart card")

        cid = self.get_citizen_id()
        if not cid:
            raise ValueError("Could not read Citizen ID (CID)")
        return cid

    def read_all_data(self, progress: Optional[ProgressCallback] = None) -> Dict[str, Any]:
        """Read all available data from the card and return a structured dictionary.

        `progress(phase, done, total)` is called as the read advances (see ProgressCallback)."""
        self._progress = progress
        try:
            return self._read_all_data()
        finally:
            self._progress = None

    def _read_all_data(self) -> Dict[str, Any]:
        if not self.connect():
            raise RuntimeError("Failed to connect to smart card")
        self._report("data", 0, DATA_FIELDS)

        cid = self.get_citizen_id()
        if not cid:
            raise ValueError("Could not read Citizen ID (CID)")
        self._report("data", 1, DATA_FIELDS)

        # Name Thai
        th_parts = self.get_thai_name_parts()
        self._report("data", 2, DATA_FIELDS)
        title_th = th_parts[0].strip() if len(th_parts) > 0 else ""
        first_th = th_parts[1].strip() if len(th_parts) > 1 else ""
        middle_th = th_parts[2].strip() if len(th_parts) > 2 else ""
        last_th = th_parts[3].strip() if len(th_parts) > 3 else ""
        full_th = f"{title_th} {first_th} {middle_th} {last_th}".replace("  ", " ").strip()

        # Name English
        en_parts = self.get_english_name_parts()
        self._report("data", 3, DATA_FIELDS)
        title_en = en_parts[0].strip() if len(en_parts) > 0 else ""
        first_en = en_parts[1].strip() if len(en_parts) > 1 else ""
        middle_en = en_parts[2].strip() if len(en_parts) > 2 else ""
        last_en = en_parts[3].strip() if len(en_parts) > 3 else ""
        full_en = f"{title_en} {first_en} {middle_en} {last_en}".replace("  ", " ").strip()

        # Date of Birth (YYYYMMDD in BE)
        dob_raw = self.get_date_of_birth()
        self._report("data", 4, DATA_FIELDS)
        birth_year_ce = None
        age = None
        if len(dob_raw) >= 8:
            try:
                be_year = int(dob_raw[:4])
                birth_year_ce = be_year - 543
                import datetime
                age = max(0, datetime.date.today().year - birth_year_ce)
            except Exception:
                pass

        # Gender
        gender = self.get_gender()
        self._report("data", 5, DATA_FIELDS)

        # Address
        addr_parts = self.get_address_parts()
        self._report("data", 6, DATA_FIELDS)
        addr_raw = " ".join([p.strip() for p in addr_parts if p.strip()]).strip()
        address_no = addr_parts[0].strip() if len(addr_parts) > 0 and addr_parts[0].strip() else None
        village_no = addr_parts[1].strip() if len(addr_parts) > 1 and addr_parts[1].strip() else None
        lane = addr_parts[2].strip() if len(addr_parts) > 2 and addr_parts[2].strip() else None
        road = addr_parts[3].strip() if len(addr_parts) > 3 and addr_parts[3].strip() else None
        subdistrict = addr_parts[5].strip() if len(addr_parts) > 5 and addr_parts[5].strip() else None
        district = addr_parts[6].strip() if len(addr_parts) > 6 and addr_parts[6].strip() else None
        province = addr_parts[7].strip() if len(addr_parts) > 7 and addr_parts[7].strip() else None

        # Clean address prefixes (e.g. ตำบล, อำเภอ, จังหวัด)
        if subdistrict:
            subdistrict = subdistrict.replace("ตำบล", "").replace("แขวง", "").strip()
        if district:
            district = district.replace("อำเภอ", "").replace("เขต", "").strip()
        if province:
            province = province.replace("จังหวัด", "").strip()
        if village_no:
            village_no = village_no.replace("หมู่ที่", "").replace("หมู่", "").replace("ม.", "").strip()

        # Dates & Issuer
        issuer = self.get_issuer()
        self._report("data", 7, DATA_FIELDS)
        issue_date = self.get_issue_date()
        self._report("data", 8, DATA_FIELDS)
        expire_date = self.get_expire_date()
        self._report("data", 9, DATA_FIELDS)

        # Photo Base64
        photo_bytes = self.get_photo_bytes()
        photo_base64 = None
        if photo_bytes:
            photo_base64 = "data:image/jpeg;base64," + base64.b64encode(photo_bytes).decode("utf-8")

        return {
            "citizen_id": cid,
            "title_th": title_th,
            "first_name_th": first_th,
            "last_name_th": last_th,
            "full_name_th": full_th,
            "title_en": title_en,
            "first_name_en": first_en,
            "last_name_en": last_en,
            "full_name_en": full_en,
            "birth_date": dob_raw,
            "birth_year_ce": birth_year_ce,
            "age": age,
            "gender": gender,
            "address_raw": addr_raw,
            "address_no": address_no,
            "village_no": village_no,
            "lane": lane,
            "road": road,
            "subdistrict": subdistrict,
            "district": district,
            "province": province,
            "photo_base64": photo_base64,
            "issuer": issuer,
            "issue_date": issue_date,
            "expire_date": expire_date
        }
