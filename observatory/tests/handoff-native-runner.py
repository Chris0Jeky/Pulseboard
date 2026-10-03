"""Runner-tripwire regressions using invented consumers, never native integration proof.

Each case runs in a fresh process because Python audit hooks cannot be removed.
Effects use only temporary files and loopback sockets. Wire evaluation is replaced
with a stop sentinel so these fixtures cannot create a passing native receipt.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

RUNNER = Path(__file__).with_name('handoff-native.py')


class ReachedWireCheck(Exception):
    pass


def exercise(kind, root):
    spec = importlib.util.spec_from_file_location('tripwire_subject', RUNNER)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    consumer = root / 'consumer'
    scripts = consumer / 'scripts'
    scripts.mkdir(parents=True)
    producer = root / 'producer'
    examples = producer / 'observatory/examples'
    examples.mkdir(parents=True)
    marker = root / 'effect.txt'
    receipt = root / 'must-not-exist.json'
    marker_code = f'from pathlib import Path; Path({str(marker)!r}).write_text("effect", encoding="utf-8")'
    child_code = ('import subprocess, sys\n'
                  f'subprocess.run([sys.executable, "-c", {marker_code!r}], check=True)\n')
    listener = None
    try:
        if kind in ('subprocess', 'dependency'):
            effect = child_code
        elif kind == 'bind':
            effect = 'import socket\nwith socket.socket() as s:\n    s.bind(("127.0.0.1", 0))\n' + marker_code + '\n'
        elif kind == 'connect':
            # Controlled listener created before the subject installs its tripwire.
            listener = socket.socket()
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            address = listener.getsockname()
            effect = f'import socket\nwith socket.socket() as s:\n    s.settimeout(2)\n    s.connect({address!r})\n' + marker_code + '\n'
        else:
            effect = ''
        if kind == 'dependency':
            (scripts / 'effect.py').write_text(effect, encoding='utf-8')
            effect = ('import sys\nfrom pathlib import Path\n'
                      'sys.path.insert(0, str(Path(__file__).parent))\nimport effect\n')
        (scripts / 'intake.py').write_text(effect + 'native = object()\n', encoding='utf-8')
        # Minimal envelope isolates bootstrap ordering, not producer/wire compatibility.
        corpus = json.dumps({'synthetic': True, 'cases': [{} for _ in range(12)]}).encode('utf-8')
        (examples / 'handoff-fixtures.synthetic.json').write_bytes(corpus)
        runner.ROOT = producer / 'observatory'
        runner.CORPUS_HASH = hashlib.sha256(corpus).hexdigest()
        def stop_before_wire(*_args):
            raise ReachedWireCheck()
        runner.check_wire = stop_before_wire
        # Real Git revision reads still have to complete before the hook is installed.
        git = ['git', '-c', f'core.hooksPath={root / "no-hooks"}', '-c', 'commit.gpgsign=false',
               '-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.test']
        for args in (['init', '-q'], ['add', '.'], ['commit', '-qm', 'Invented runner fixture']):
            subprocess.run(git + args, cwd=root, check=True, capture_output=True, timeout=10)
        revision = runner.revision(root)
        reads = []
        original_revision = runner.revision
        def record_revision(directory):
            reads.append(str(directory))
            return original_revision(directory)
        runner.revision = record_revision
        try:
            runner.run(argparse.Namespace(consumer=consumer, consumer_sha=revision, receipt=receipt))
        except ReachedWireCheck:
            phase = 'wire-boundary'
        except AssertionError as error:
            if not str(error).startswith('Native conformance attempted an external action: '):
                raise
            phase = str(error).split(': ', 1)[1]
        else:
            raise AssertionError('Fixture unexpectedly produced a native receipt')
        print(json.dumps({'phase': phase, 'effect': marker.exists(), 'receipt': receipt.exists(), 'revisionReads': len(reads)}))
    finally:
        if listener is not None:
            listener.close()


class ImportTripwireTests(unittest.TestCase):
    def check_case(self, kind, expected):
        with tempfile.TemporaryDirectory(prefix='handoff-runner-test-') as temporary:
            result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--fixture', kind, temporary],
                                    capture_output=True, text=True, timeout=20,
                                    env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout),
                             {'phase': expected, 'effect': False, 'receipt': False, 'revisionReads': 2})

    def test_import_time_subprocess_is_blocked(self):
        self.check_case('subprocess', 'subprocess.Popen')

    def test_imported_dependency_subprocess_is_blocked(self):
        self.check_case('dependency', 'subprocess.Popen')

    def test_import_time_bind_is_blocked(self):
        self.check_case('bind', 'socket.bind')

    def test_import_time_connect_is_blocked(self):
        self.check_case('connect', 'socket.connect')

    def test_inert_import_reaches_wire_checks_after_real_revision_reads(self):
        self.check_case('inert', 'wire-boundary')


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--fixture':
        exercise(sys.argv[2], Path(sys.argv[3]))
    else:
        unittest.main(verbosity=2)
