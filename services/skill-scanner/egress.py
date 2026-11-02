"""TLS tunnels to fixed analysis dependencies. Scanner network has no default egress."""
import ipaddress
import selectors
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOSTS = frozenset({"api.osv.dev", "api.openai.com", "openrouter.ai", "integrate.api.nvidia.com"})


def destination(authority: str) -> tuple[str, int]:
    host, separator, port = authority.partition(":")
    if separator != ":" or port != "443" or host not in HOSTS:
        raise ValueError("destination_denied")
    return host, 443


def connect_public(host: str, port: int):
    deadline = time.monotonic() + 10
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("private_destination_denied")
    last = None
    for family, kind, protocol, _, address in addresses[:4]:
        if time.monotonic() >= deadline:
            break
        connection = socket.socket(family, kind, protocol)
        connection.settimeout(max(.1, deadline - time.monotonic()))
        try:
            connection.connect(address)  # Connect the checked address, no second DNS lookup.
            return connection
        except OSError as error:
            last = error
            connection.close()
    raise OSError("destination_unavailable") from last


class EgressServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8
    slots = threading.BoundedSemaphore(8)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        request.settimeout(5)
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_CONNECT(self):
        connection = None
        try:
            if self.headers.get("Origin"):
                raise ValueError("origin_denied")
            host, port = destination(self.path)
            connection = connect_public(host, port)
        except (ValueError, OSError):
            self.send_error(403)
            return
        try:
            self.send_response(200, "Connection established")
            self.end_headers()
            self.wfile.flush()
            connection.settimeout(5)
            self.connection.settimeout(5)
            transferred, deadline = 0, time.monotonic() + 60
            with selectors.DefaultSelector() as selector:
                selector.register(self.connection, selectors.EVENT_READ, connection)
                selector.register(connection, selectors.EVENT_READ, self.connection)
                while time.monotonic() < deadline:
                    for key, _ in selector.select(.5):
                        data = key.fileobj.recv(16384)
                        if not data:
                            return
                        transferred += len(data)
                        if transferred > 2 * 1024 * 1024:
                            return
                        key.data.sendall(data)
        except OSError:
            pass
        finally:
            self.close_connection = True
            connection.close()


if __name__ == "__main__":
    EgressServer(("0.0.0.0", 8082), Handler).serve_forever()
