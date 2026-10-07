"""Two loopback-only HTTPS origins with bounded, actual-socket collector receipts."""
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import ssl
import subprocess
import sys
import tempfile
import threading
from urllib.parse import urlsplit


def safe_url(value):
    """Bound diagnostics and omit credentials, query strings and fragments."""
    parsed = urlsplit(value)
    host = parsed.hostname or ''
    if ':' in host:
        host = '[' + host + ']'
    port = ':' + str(parsed.port) if parsed.port else ''
    return f'{parsed.scheme}://{host}{port}{parsed.path}'[:240]


class HttpsFixture:
    def __init__(self, max_age):
        if max_age not in (0, 600):
            raise ValueError('Expected a cold (0) or cached (600) preflight fixture')
        self.max_age = max_age
        self.receipts = deque(maxlen=64)
        self.trace = deque(maxlen=64)
        self.tls_alerts = deque(maxlen=64)
        self.script = ''
        self._servers = []
        self._temporary = None

    def __enter__(self):
        self._temporary = tempfile.TemporaryDirectory(prefix='pulseboard-https-')
        root = Path(self._temporary.name)
        cert, key = root / 'cert.pem', root / 'key.pem'
        try:
            subprocess.run([
                'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                '-keyout', str(key), '-out', str(cert), '-days', '1',
                '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1',
            ], check=True, capture_output=True, timeout=15)
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(cert, key)
            self.source_origin = self._start('source', tls)
            self.collector_origin = self._start('collector', tls)
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def _start(self, role, tls):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def setup(self):
                self.request.settimeout(3)
                super().setup()

            def log_message(self, *_):
                pass

            def reply(self, status, body=b'', content_type='application/json', cors=False):
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                if cors:
                    self.send_header('Access-Control-Allow-Origin', fixture.source_origin)
                    self.send_header('Vary', 'Origin')
                    self.send_header('Access-Control-Allow-Methods', 'POST')
                    self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                    self.send_header('Access-Control-Max-Age', str(fixture.max_age))
                self.end_headers()
                if body:
                    self.wfile.write(body)

            def do_GET(self):
                if role != 'source':
                    return self.reply(404)
                pages = {
                    '/': ("<!doctype html><a id='leave' href='/next'>Leave this page</a>"
                          "<script src='/observer.js'></script>").encode(),
                    '/next': b"<!doctype html><main id='arrived'>Arrived</main>",
                    '/observer.js': fixture.script.encode(),
                }
                if self.path == '/favicon.ico':
                    return self.reply(204)
                if self.path not in pages:
                    return self.reply(404)
                kind = 'application/javascript' if self.path == '/observer.js' else 'text/html'
                self.reply(200, pages[self.path], kind + '; charset=utf-8')

            def collect(self):
                if role != 'collector' or self.path != '/v1/collect/mdviewer':
                    self.reply(404)
                    return
                fixture.trace.append({'method': self.command, 'path': self.path})
                if self.command == 'OPTIONS':
                    return self.reply(204, cors=True)
                length = self.headers.get('Content-Length', '')
                if not length.isdecimal():
                    return self.reply(400)
                if int(length) > 65536:
                    return self.reply(413)
                self.connection.settimeout(3)
                try:
                    raw = self.rfile.read(int(length))
                    if len(raw) != int(length):
                        return self.reply(400)
                    body = raw.decode('utf-8')
                except (OSError, UnicodeDecodeError):
                    return self.reply(400)
                fixture.receipts.append({
                    'body': body, 'headers': {k.lower(): v for k, v in self.headers.items()},
                    'url': fixture.collector_origin + self.path,
                })
                self.reply(202, b'{}', cors=True)

            do_POST = collect
            do_OPTIONS = collect

        class FixtureServer(ThreadingHTTPServer):
            def handle_error(self, request, client_address):
                error = sys.exc_info()[1]
                if isinstance(error, ssl.SSLError) and getattr(error, 'reason', None) in (
                    'TLSV1_ALERT_UNKNOWN_CA', 'SSLV3_ALERT_CERTIFICATE_UNKNOWN',
                ):
                    # Browsers may reject the temporary certificate before retrying
                    # under the fixture context's explicit trust exception. Keep the
                    # observation, not a repeated traceback or client address.
                    fixture.tls_alerts.append({'role': role, 'reason': error.reason})
                    return
                super().handle_error(request, client_address)

        server = FixtureServer(('127.0.0.1', 0), Handler)
        server.socket = tls.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        self._servers.append((server, thread))
        thread.start()
        return f'https://127.0.0.1:{server.server_port}'

    def __exit__(self, *_):
        for server, thread in reversed(self._servers):
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
        self._servers.clear()
        if self.tls_alerts:
            print(json.dumps({'fixtureRecentTlsAlerts': list(self.tls_alerts)}))
        if self._temporary:
            self._temporary.cleanup()
