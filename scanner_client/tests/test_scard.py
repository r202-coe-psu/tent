import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import scard
from app.scard import ReaderLostError, ThaiSmartCardReader

CID = "3101234567891"
READER_NAME = "Identive CLOUD 2700 R Smart Card Reader [CCID Interface] 00 00"

S_SUCCESS = 0
E_NO_SERVICE = 0x8010001D
E_TIMEOUT = 0x8010000A
STATE_PRESENT = 0x20


class FakePcsc:
    """The slice of smartcard.scard the reader uses, with the slot state under test control."""

    SCARD_S_SUCCESS = S_SUCCESS
    SCARD_SCOPE_USER = 0
    SCARD_STATE_UNAWARE = 0x0
    SCARD_STATE_UNKNOWN = 0x4
    SCARD_STATE_UNAVAILABLE = 0x8
    SCARD_STATE_PRESENT = STATE_PRESENT
    SCARD_E_NO_SERVICE = E_NO_SERVICE
    SCARD_E_SERVICE_STOPPED = 0x8010001E
    SCARD_E_INVALID_HANDLE = 0x80100003
    SCARD_E_UNKNOWN_READER = 0x80100009
    SCARD_E_READER_UNAVAILABLE = 0x80100017
    SCARD_E_NO_READERS_AVAILABLE = 0x8010002E

    def __init__(self):
        self.hresult = S_SUCCESS
        self.event_state = 0x10  # SCARD_STATE_EMPTY
        self.open_contexts = set()
        self.next_context = 100

    def SCardEstablishContext(self, scope):
        self.next_context += 1
        self.open_contexts.add(self.next_context)
        return S_SUCCESS, self.next_context

    def SCardReleaseContext(self, context):
        self.open_contexts.discard(context)
        return S_SUCCESS

    def SCardGetStatusChange(self, context, timeout, states):
        assert context in self.open_contexts
        assert states == [(READER_NAME, self.SCARD_STATE_UNAWARE)]
        if self.hresult != S_SUCCESS:
            return self.hresult, []
        return S_SUCCESS, [(READER_NAME, self.event_state, [0x3B, 0x79])]

    @staticmethod
    def SCardGetErrorMessage(hresult):
        return f"error 0x{hresult:08x}"


class FakeConnection:
    """Behaves like pyscard's PCSCCardConnection: connect() opens a new card handle and drops the
    previous one without disconnecting it, so only disconnect() frees a handle in pcscd."""

    def __init__(self, pcscd_handles):
        self.pcscd_handles = pcscd_handles
        self.hcard = None
        self.connects = 0
        self.released = False

    def connect(self):
        self.connects += 1
        self.hcard = object()
        self.pcscd_handles.add(self.hcard)

    def disconnect(self):
        if self.hcard is not None:
            self.pcscd_handles.discard(self.hcard)
            self.hcard = None

    def release(self):
        self.released = True

    def getATR(self):
        return [0x3B, 0x79]

    def transmit(self, apdu):
        if apdu[:2] == [0x00, 0xC0]:  # GET RESPONSE carries the field
            return list(CID.encode()), 0x90, 0x00
        return [], 0x61, 0x0D


class FakeReaderEntry:
    def __init__(self, connection):
        self.connection = connection

    def createConnection(self):
        return self.connection

    def __str__(self):
        return READER_NAME


class PcscReaderTests(unittest.TestCase):
    def setUp(self):
        self.pcsc = FakePcsc()
        self.pcscd_handles = set()
        self.connection = FakeConnection(self.pcscd_handles)
        patcher_pcsc = patch.object(scard, "pcsc", self.pcsc)
        patcher_readers = patch.object(
            scard, "readers", lambda: [FakeReaderEntry(self.connection)]
        )
        patcher_pcsc.start()
        patcher_readers.start()
        self.addCleanup(patcher_pcsc.stop)
        self.addCleanup(patcher_readers.stop)
        self.reader = ThaiSmartCardReader()

    def test_polling_a_present_card_never_connects(self):
        self.pcsc.event_state = 0x20 | 0x10000  # PRESENT, plus an event counter in the high word
        for _ in range(1000):
            self.assertTrue(self.reader.is_card_inserted())
        self.assertEqual(self.connection.connects, 0)
        self.assertEqual(self.pcscd_handles, set())

    def test_empty_slot_is_not_inserted(self):
        self.assertFalse(self.reader.is_card_inserted())

    def test_repeated_reads_keep_one_card_handle_open(self):
        # Before the fix every connect leaked a handle until pcscd hit its 200-per-reader limit.
        for _ in range(250):
            self.assertEqual(self.reader.read_citizen_id(), CID)
        self.assertEqual(self.connection.connects, 250)
        self.assertEqual(len(self.pcscd_handles), 1)

    def test_lost_service_raises_reader_lost(self):
        self.pcsc.hresult = E_NO_SERVICE
        with self.assertRaises(ReaderLostError):
            self.reader.is_card_inserted()

    def test_unknown_reader_state_raises_reader_lost(self):
        self.pcsc.event_state = FakePcsc.SCARD_STATE_UNKNOWN
        with self.assertRaises(ReaderLostError):
            self.reader.is_card_inserted()

    def test_a_failed_poll_before_any_answer_is_not_inserted(self):
        self.pcsc.hresult = E_TIMEOUT
        self.assertFalse(self.reader.is_card_inserted())
        self.pcsc.hresult = S_SUCCESS
        self.pcsc.event_state = STATE_PRESENT
        self.assertTrue(self.reader.is_card_inserted())

    def test_a_failed_poll_keeps_reporting_the_card_that_is_in(self):
        # Regression: a transient failure read as "card removed" and ended the removal wait.
        self.pcsc.event_state = STATE_PRESENT | (3 << 16)
        self.assertTrue(self.reader.is_card_inserted())
        self.pcsc.hresult = E_TIMEOUT
        for _ in range(scard.MAX_POLL_FAILURES - 1):
            self.assertTrue(self.reader.is_card_inserted())
        self.pcsc.hresult = S_SUCCESS
        self.assertTrue(self.reader.is_card_inserted())  # same card: the count did not move

    def test_a_failed_poll_keeps_reporting_an_empty_slot(self):
        self.assertFalse(self.reader.is_card_inserted())
        self.pcsc.hresult = E_TIMEOUT
        self.assertFalse(self.reader.is_card_inserted())

    def test_repeated_failed_polls_raise_reader_lost(self):
        self.pcsc.hresult = E_TIMEOUT
        for _ in range(scard.MAX_POLL_FAILURES - 1):
            self.assertFalse(self.reader.is_card_inserted())
        with self.assertRaises(ReaderLostError):
            self.reader.is_card_inserted()

    def test_repeated_failed_polls_raise_reader_lost_even_with_a_card_in(self):
        self.pcsc.event_state = STATE_PRESENT
        self.assertTrue(self.reader.is_card_inserted())
        self.pcsc.hresult = E_TIMEOUT
        for _ in range(scard.MAX_POLL_FAILURES - 1):
            self.assertTrue(self.reader.is_card_inserted())
        with self.assertRaises(ReaderLostError):
            self.reader.is_card_inserted()

    def test_a_good_poll_resets_the_failure_count(self):
        self.pcsc.event_state = STATE_PRESENT
        self.assertTrue(self.reader.is_card_inserted())
        for _ in range(3):
            self.pcsc.hresult = E_TIMEOUT
            for _ in range(scard.MAX_POLL_FAILURES - 1):
                self.assertTrue(self.reader.is_card_inserted())
            self.pcsc.hresult = S_SUCCESS
            self.assertTrue(self.reader.is_card_inserted())

    def test_a_card_swapped_between_polls_reads_as_removed_once(self):
        # Pulled and put back within one poll interval: the slot is never seen empty, but
        # pcsc-lite's event count (high word) moved by two.
        self.pcsc.event_state = STATE_PRESENT | (5 << 16)
        self.assertTrue(self.reader.is_card_inserted())
        self.pcsc.event_state = STATE_PRESENT | (7 << 16)
        self.assertFalse(self.reader.is_card_inserted())
        self.assertTrue(self.reader.is_card_inserted())  # then it is the new card, inserted
        self.assertTrue(self.reader.is_card_inserted())

    def test_a_card_inserted_into_an_empty_slot_is_not_a_swap(self):
        self.pcsc.event_state = 0x10 | (4 << 16)  # EMPTY
        self.assertFalse(self.reader.is_card_inserted())
        self.pcsc.event_state = STATE_PRESENT | (5 << 16)
        self.assertTrue(self.reader.is_card_inserted())

    def test_the_first_poll_of_a_new_reader_is_not_a_swap(self):
        self.pcsc.event_state = STATE_PRESENT | (9 << 16)
        self.assertTrue(self.reader.is_card_inserted())

    def test_a_swap_hidden_behind_a_failed_poll_is_still_noticed(self):
        self.pcsc.event_state = STATE_PRESENT | (1 << 16)
        self.assertTrue(self.reader.is_card_inserted())
        self.pcsc.hresult = E_TIMEOUT
        self.assertTrue(self.reader.is_card_inserted())
        self.pcsc.hresult = S_SUCCESS
        self.pcsc.event_state = STATE_PRESENT | (3 << 16)
        self.assertFalse(self.reader.is_card_inserted())

    def test_the_event_count_wraps_without_a_false_swap(self):
        self.pcsc.event_state = STATE_PRESENT | (0xFFFF << 16)
        self.assertTrue(self.reader.is_card_inserted())
        self.assertTrue(self.reader.is_card_inserted())

    def test_close_frees_the_card_handle_and_contexts(self):
        self.reader.read_citizen_id()
        self.reader.close()
        self.assertEqual(self.pcscd_handles, set())
        self.assertEqual(self.pcsc.open_contexts, set())
        self.assertTrue(self.connection.released)
        with self.assertRaises(ReaderLostError):
            self.reader.is_card_inserted()


class InjectedConnectionTests(unittest.TestCase):
    def test_connect_leaves_a_non_pcsc_connection_alone(self):
        connection = SimpleNamespace(
            connect=lambda: None,
            getATR=lambda: [0x3B, 0x79],
            transmit=lambda apdu: ([], 0x90, 0x00),
        )
        self.assertTrue(ThaiSmartCardReader(connection=connection).connect())


if __name__ == "__main__":
    unittest.main()
