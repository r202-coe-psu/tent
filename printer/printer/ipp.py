"""Read a CUPS job's job-state over IPP (RFC 8010) from the local cupsd.

lpstat never prints job-state, and the job-state-reasons it shows as "Alerts:" differ by version:
CUPS 2.3.3 leaves processing-to-stop-point on a job that printed fine, 2.4 says
job-completed-successfully. job-state itself is the same everywhere.
"""

import struct

import httpx

_JOB_STATES = {
    3: "pending",
    4: "pending-held",
    5: "processing",
    6: "processing-stopped",
    7: "canceled",
    8: "aborted",
    9: "completed",
}
_GET_JOB_ATTRIBUTES = 0x0009
_TAG_END = 0x03
_TAG_ENUM = 0x23


def _attr(tag: int, name: str, value: bytes) -> bytes:
    raw = name.encode()
    return struct.pack(">BH", tag, len(raw)) + raw + struct.pack(">H", len(value)) + value


def _request(job_number: str) -> bytes:
    return (
        struct.pack(">BBHI", 2, 0, _GET_JOB_ATTRIBUTES, 1)
        + b"\x01"  # operation-attributes
        + _attr(0x47, "attributes-charset", b"utf-8")
        + _attr(0x48, "attributes-natural-language", b"en")
        + _attr(0x45, "job-uri", f"ipp://localhost/jobs/{job_number}".encode())
        + _attr(0x44, "requested-attributes", b"job-state")
        + bytes([_TAG_END])
    )


def _parse_job_state(body: bytes) -> str | None:
    try:
        (status,) = struct.unpack(">H", body[2:4])
        if status >= 0x0100:  # not successful-*
            return None
        i = 8
        while i < len(body):
            tag = body[i]
            i += 1
            if tag == _TAG_END:
                return None
            if tag < 0x10:  # attribute-group delimiter
                continue
            (name_len,) = struct.unpack(">H", body[i : i + 2])
            name = body[i + 2 : i + 2 + name_len]
            i += 2 + name_len
            (value_len,) = struct.unpack(">H", body[i : i + 2])
            value = body[i + 2 : i + 2 + value_len]
            i += 2 + value_len
            if len(value) != value_len:
                return None
            if name == b"job-state" and tag == _TAG_ENUM and value_len == 4:
                return _JOB_STATES.get(struct.unpack(">i", value)[0])
    except struct.error:
        return None
    return None


def job_state(
    job_id: str,
    *,
    base_url: str = "http://localhost:631",
    transport: httpx.BaseTransport | None = None,
    timeout: float = 5.0,
) -> str | None:
    """job-state of an `lp` request id like "tent_xprinter-3", or None if cupsd can't say."""
    number = job_id.rsplit("-", 1)[-1]
    if not number.isdigit():
        return None
    try:
        with httpx.Client(
            base_url=base_url, transport=transport, timeout=timeout, trust_env=False
        ) as client:
            response = client.post(
                f"/jobs/{number}",
                content=_request(number),
                headers={"content-type": "application/ipp"},
            )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    return _parse_job_state(response.content)
