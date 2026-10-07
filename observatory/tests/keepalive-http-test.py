"""Contract tests for the isolated HTTPS receipt fixture, never production endpoints."""
import json
import io
import threading
from contextlib import redirect_stderr
from http.client import HTTPSConnection
import ssl
import unittest
from urllib.error import URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

from keepalive_http import HttpsFixture, safe_url


class FixtureTests(unittest.TestCase):
    def test_diagnostic_urls_drop_credentials_query_and_fragment(self):
        self.assertEqual(safe_url('https://user:secret@example.test/path?token=secret#private'), 'https://example.test/path')
        self.assertEqual(len(safe_url('https://example.test/' + 'a' * 500)), 240)

    def test_expected_self_signed_rejection_is_a_bounded_diagnostic_not_a_stack_trace(self):
        with HttpsFixture(max_age=0) as fixture:
            server = fixture._servers[0][0]
            handled = threading.Event()
            original = server.handle_error

            def observe(*args):
                try:
                    original(*args)
                finally:
                    handled.set()

            server.handle_error = observe
            stderr = io.StringIO()
            with redirect_stderr(stderr):
                with self.assertRaises(URLError):
                    urlopen(fixture.source_origin, context=ssl.create_default_context(), timeout=3)
                self.assertTrue(handled.wait(3), 'server never observed the TLS rejection')
            self.assertNotIn('Traceback', stderr.getvalue())
            self.assertEqual(len(fixture.tls_alerts), 1)
            self.assertEqual(fixture.tls_alerts[0]['role'], 'source')
            self.assertIn(fixture.tls_alerts[0]['reason'], ('TLSV1_ALERT_UNKNOWN_CA', 'SSLV3_ALERT_CERTIFICATE_UNKNOWN'))
            self.assertEqual(fixture.tls_alerts.maxlen, 64)
            self.assertEqual(len(fixture.receipts), 0)
            # A later fixture-authorized request still traverses the same real socket.
            with urlopen(fixture.source_origin, context=ssl._create_unverified_context(), timeout=3) as response:
                self.assertEqual(response.status, 200)

    def test_unexpected_server_failures_keep_their_traceback(self):
        with HttpsFixture(max_age=0) as fixture:
            server = fixture._servers[0][0]
            for error in (ValueError('unexpected fixture failure'), ssl.SSLError('unexpected TLS failure')):
                stderr = io.StringIO()
                with redirect_stderr(stderr):
                    try:
                        raise error
                    except Exception:
                        server.handle_error(None, ('127.0.0.1', 0))
                self.assertIn('Traceback', stderr.getvalue())
                self.assertIn(str(error), stderr.getvalue())

    def test_https_origins_cors_receipts_and_body_bound(self):
        with HttpsFixture(max_age=0) as fixture:
            context = ssl._create_unverified_context()  # Only the fixture's ephemeral certificate.
            fixture.script = '/* synthetic script */'
            with urlopen(fixture.source_origin + '/observer.js', context=context, timeout=3) as response:
                self.assertEqual(response.read(), b'/* synthetic script */')
            self.assertNotEqual(fixture.source_origin, fixture.collector_origin)
            endpoint = fixture.collector_origin + '/v1/collect/mdviewer'
            request = Request(endpoint, method='OPTIONS', headers={
                'Origin': fixture.source_origin, 'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type',
            })
            with urlopen(request, context=context, timeout=3) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], fixture.source_origin)
                self.assertEqual(response.headers['Access-Control-Max-Age'], '0')
            body = json.dumps({'events': []}).encode()
            request = Request(endpoint, data=body, headers={'Origin': fixture.source_origin, 'Content-Type': 'application/json'})
            with urlopen(request, context=context, timeout=3) as response:
                self.assertEqual(response.status, 202)
            self.assertEqual(fixture.receipts[0]['body'], body.decode())
            self.assertEqual(fixture.receipts[0]['headers']['origin'], fixture.source_origin)
            self.assertEqual(fixture.trace[0]['method'], 'OPTIONS')
            # The inclusive upper bound must still be fully received, not refused.
            request = Request(endpoint, data=b'x' * 65536)
            with urlopen(request, context=context, timeout=3) as response:
                self.assertEqual(response.status, 202)
            self.assertEqual(len(fixture.receipts), 2)
            self.assertEqual(fixture.receipts[-1]['body'], 'x' * 65536)

    def test_oversized_content_length_is_rejected_before_reading_body(self):
        with HttpsFixture(max_age=0) as fixture:
            target = urlsplit(fixture.collector_origin)
            connection = HTTPSConnection(
                target.hostname, target.port,
                context=ssl._create_unverified_context(), timeout=3,
            )
            try:
                # Send only headers: early 413 must not wait for or consume a body.
                # Uploading the refused body races the server's connection close and
                # can yield a client BrokenPipeError before it reads the valid 413.
                connection.putrequest('POST', '/v1/collect/mdviewer')
                connection.putheader('Content-Length', '65537')
                connection.endheaders()
                response = connection.getresponse()
                self.assertEqual(response.status, 413)
                self.assertEqual(response.read(), b'')
                self.assertEqual(len(fixture.receipts), 0)
                self.assertEqual(list(fixture.trace), [{'method': 'POST', 'path': '/v1/collect/mdviewer'}])
            finally:
                connection.close()


if __name__ == '__main__':
    unittest.main()
