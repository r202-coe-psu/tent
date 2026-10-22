import socket


def local_ips() -> list[str]:
    """LAN IPv4 address(es) of this machine, for the boot slip. Never raises."""
    found: list[str] = []
    try:
        # UDP connect sends nothing; it only makes the kernel pick the outbound interface address.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            found.append(sock.getsockname()[0])
    except OSError:
        pass
    if not found:
        try:
            _, _, addresses = socket.gethostbyname_ex(socket.gethostname())
        except OSError:
            addresses = []
        found.extend(a for a in addresses if not a.startswith("127."))
    return found
