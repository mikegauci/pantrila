"""Direct HTTP fetches pinned to vetted addresses with an absolute socket deadline.

No proxy or second hostname lookup is involved. HTTPS still verifies the original hostname.
"""

import http.client
import socket
import ssl
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from urllib.parse import urlsplit

import httpx


class PinnedConnection(http.client.HTTPConnection):
    def __init__(
        self,
        host: str,
        port: int,
        address: str,
        secure: bool,
        deadline: float,
        connect_timeout: float = 3.0,
    ):
        super().__init__(host, port, timeout=max(0.001, deadline - time.monotonic()))
        self.address, self.secure, self.deadline = address, secure, deadline
        self.connect_timeout = connect_timeout
        self.timer: threading.Timer | None = None
        self.active_socket: socket.socket | None = None

    def expire(self):
        sock = self.active_socket
        if sock is not None:
            with suppress(OSError):
                sock.shutdown(socket.SHUT_RDWR)
            sock.close()

    def connect(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("page deadline exceeded")
        family = socket.AF_INET6 if ":" in self.address else socket.AF_INET
        sock = socket.socket(family, socket.SOCK_STREAM)
        self.active_socket = self.sock = sock
        sock.settimeout(min(self.connect_timeout, remaining))
        self.timer = threading.Timer(remaining, self.expire)
        self.timer.daemon = True
        self.timer.start()
        sock.connect((self.address, self.port))
        if self.secure:
            # Set the active TLS socket before the handshake so the deadline can interrupt it.
            tls = ssl.create_default_context().wrap_socket(
                sock, server_hostname=self.host, do_handshake_on_connect=False
            )
            self.active_socket = self.sock = tls
            if time.monotonic() >= self.deadline:
                raise TimeoutError("page deadline exceeded")
            tls.do_handshake()
        self.sock.settimeout(max(0.001, self.deadline - time.monotonic()))

    def close(self):
        if self.timer is not None:
            self.timer.cancel()
        self.expire()
        super().close()


class PageResponse:
    def __init__(self, response: http.client.HTTPResponse, deadline: float):
        self.response, self.deadline = response, deadline
        self.status_code = response.status
        self.headers = httpx.Headers(response.getheaders())
        self.is_redirect = response.status in (301, 302, 303, 307, 308)
        self.encoding = httpx.Response(response.status, headers=self.headers).encoding

    def iter_bytes(self) -> Iterator[bytes]:
        while True:
            if time.monotonic() >= self.deadline:
                raise TimeoutError("page deadline exceeded")
            chunk = self.response.read1(64 * 1024)
            if not chunk:
                if time.monotonic() >= self.deadline:
                    raise TimeoutError("page deadline exceeded")
                return
            yield chunk


@contextmanager
def pinned_page(url: str, addresses: list[str], headers: dict, deadline: float):
    parts = urlsplit(url)
    secure = parts.scheme == "https"
    port = parts.port or (443 if secure else 80)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    failure = None
    for index, address in enumerate(addresses):
        # Leave time for remaining vetted addresses if the first one cannot connect.
        connect_timeout = max(
            0.001, min(3.0, (deadline - time.monotonic()) / (len(addresses) - index))
        )
        conn = PinnedConnection(parts.hostname, port, address, secure, deadline, connect_timeout)
        try:
            conn.request("GET", path, headers={**headers, "Accept-Encoding": "identity"})
            response = conn.getresponse()
        except (OSError, http.client.HTTPException) as exc:
            conn.close()
            failure = exc
            continue
        try:
            with response:
                yield PageResponse(response, deadline)
        finally:
            conn.close()
        return
    raise failure or OSError("No validated address was reachable")
