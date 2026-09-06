"""Pure unit tests for external shelter-residency mapping (CR-112)."""

from apiapp.modules.external.residency import map_shelter_residency


def test_checked_in_for_present_statuses():
    for status in ("active", "room_confirmed", "temporary_leave"):
        binary, stay_status, in_zone = map_shelter_residency(status)
        assert binary == "CHECKED_IN"
        assert stay_status == status
        assert in_zone is (status == "room_confirmed")


def test_checked_out_for_non_present_statuses():
    for status in (
        "pre_registered",
        "arriving",
        "checked_out",
        "transferred",
        "deceased",
        "cancelled",
    ):
        binary, stay_status, in_zone = map_shelter_residency(status)
        assert binary == "CHECKED_OUT"
        assert stay_status == status
        assert in_zone is False


def test_in_zone_only_for_room_confirmed():
    assert map_shelter_residency("room_confirmed") == ("CHECKED_IN", "room_confirmed", True)
    assert map_shelter_residency("active") == ("CHECKED_IN", "active", False)
