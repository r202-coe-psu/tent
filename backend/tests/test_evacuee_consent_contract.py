"""FR-34 — pydantic `EvacueeConsent` agrees with the shared contract fixture (Zod reads it too)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from tent_model.evacuee_consent import (
    CONSENT_CHANNELS,
    CONSENT_GIVERS,
    CONSENT_MODES,
    EVACUEE_SCHEMA_V,
    FullWebConsentGrant,
    bind_web_consent,
    evacuee_consent_adapter,
)

_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "tent-model"
    / "contracts"
    / "evacuee-consent.cases.json"
)
CASES = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def test_enums_and_schema_v_match_the_fixture() -> None:
    assert list(CONSENT_MODES) == CASES["enums"]["modes"]
    assert list(CONSENT_GIVERS) == CASES["enums"]["givers"]
    assert list(CONSENT_CHANNELS) == CASES["enums"]["channels"]
    assert EVACUEE_SCHEMA_V == CASES["schema_v"]


@pytest.mark.parametrize("case", CASES["valid"], ids=lambda c: c["name"])
def test_accepts_valid_case(case: dict) -> None:
    consent = evacuee_consent_adapter.validate_python(case["consent"])
    assert evacuee_consent_adapter.dump_python(consent) == case["consent"]


@pytest.mark.parametrize("case", CASES["invalid"], ids=lambda c: c["name"])
def test_rejects_invalid_case(case: dict) -> None:
    with pytest.raises(ValidationError):
        evacuee_consent_adapter.validate_python(case["consent"])


def test_bind_web_consent_sets_channel_and_giver() -> None:
    grant = FullWebConsentGrant(
        mode="full",
        health=True,
        ref="CS-7K3QZ9MD",
        given_at="2026-10-25T03:15:00.000Z",
        notice_version="2026-10-25",
        given_by="guardian",
    )
    bound = bind_web_consent(grant, "evacuee:01JAAAAAAAAAAAAAAAAAAAAAAA")
    assert bound.channel == "web"
    assert bound.giver_evacuee_id == "evacuee:01JAAAAAAAAAAAAAAAAAAAAAAA"
    assert bound.recorded_verbally_by is None
    assert bound.given_at == "2026-10-25T03:15:00.000Z"
