"""Contract tests for the isolated HTTPS receipt fixture, never production endpoints."""
import json
import ssl
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from keepalive_http import HttpsFixture, safe_url


class FixtureTests(unittest.TestCase):
    def test_diagnostic_urls_drop_credentials_query_and_fragment(self):
        self.assertEqual(safe_url('https://user:secret@example.test/path?token=secret#private'), 'https://example.test/path')
        self.assertEqual(len(safe_url('https://example.test/' + 'a' * 500)), 240)

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
            request = Request(endpoint, data=b'x' * (65536 + 1))
            with self.assertRaises(HTTPError) as raised:
                urlopen(request, context=context, timeout=3)
            self.assertEqual(raised.exception.code, 413)
            self.assertEqual(len(fixture.receipts), 1)


if __name__ == '__main__':
    unittest.main()
