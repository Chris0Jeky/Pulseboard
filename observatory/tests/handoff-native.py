"""Pinned Pulseboard -> Agent-HQ native conformance; all writes stay in temporary campaigns.

This executes the actual consumer parser, preview/apply and outcome validator.
It never executes a probe or claims native Taskdeck/installed-service coverage.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import platform
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOW = 1791028800000
CORPUS_HASH = 'dfe57fddc4f412b4ff2511528802651297283719469e4d4bac77028d6d909241'


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def must_refuse(operation):
    try:
        operation()
    except ValueError:
        return
    raise AssertionError('Malformed or unacknowledged handoff was accepted')


def check_wire(native, corpus):
    count = 0
    for vector in corpus['cases']:
        raw = vector['text'].encode('utf-8')
        packet = json.loads(raw)
        assert hashlib.sha256(raw).hexdigest() == vector['fileSha256']
        assert native.validate(packet) == packet
        assert native.subject_hash(packet) == vector['signalSha256']
        assert native.subject_hash(packet)[:12] == vector['fingerprint']
        assert type(packet['generatedAt']) is int and isinstance(packet['evidence'], dict)
        target = packet['project'] or 'mdviewer'
        receipt = native.receipt(packet, raw, repo=target, now=NOW, allow_stale=True, allow_demo=True)
        assert receipt['source_schema'] == packet['schema']
        assert receipt['reviewed_file_sha256'] == vector['fileSha256']
        assert receipt['window'] == packet['window'] and receipt['generatedAt'] == NOW
        assert receipt['source_stale'] is packet['stale']
        assert receipt['mode'] == 'demo' and receipt['synthetic_accepted'] is True
        must_refuse(lambda: native.receipt(packet, raw, repo=target, now=NOW, allow_stale=True))
        must_refuse(lambda: native.receipt(packet, raw, repo=target, now=NOW - 1, allow_stale=True, allow_demo=True))
        must_refuse(lambda: native.receipt(packet, raw, repo=target, now=NOW + 1800001, allow_demo=True))
        if packet['project']:
            must_refuse(lambda: native.receipt(packet, raw, repo='mdviewer', now=NOW, allow_demo=True))
        count += 1
    sample = json.loads(next(x['text'] for x in corpus['cases'] if x['id'] == 'project-7d-v2'))
    changes = [
        lambda p: p.update(generatedAt=True), lambda p: p.update(generatedAt=NOW + 0.5),
        lambda p: p.update(schema='pulseboard.handoff/99'), lambda p: p.update(mode='production'),
        lambda p: p.update(destination='execute'), lambda p: p.update(stale='false'),
        lambda p: p.update(evidence='coerced string'), lambda p: p.update(fingerprint='0' * 12),
        lambda p: p['window'].update(end=NOW - 1), lambda p: p['window'].update(days=90),
        lambda p: p['rule'].update(extra='unknown'), lambda p: p.update(title='x' * 241),
        lambda p: p.update(execute=True), lambda p: p.update(evidence={'items': [0] * 129}),
    ]
    for change in changes:
        bad = copy.deepcopy(sample)
        change(bad)
        must_refuse(lambda: native.validate(bad))
    return {'wireCases': count, 'malformedCases': len(changes)}


def file_state(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


def check_intake(intake, corpus):
    # Only the clock is controlled. Registry, parser, renderer, publisher and validator are real.
    intake._now_ms = lambda: NOW
    intake._now = lambda: '2026-10-03T12:00:00Z'
    seen = 0
    with tempfile.TemporaryDirectory(prefix='pulseboard-native-proof-') as temporary:
        for vector in corpus['cases']:
            root = Path(temporary) / vector['id']
            (root / 'campaigns/active/conformance').mkdir(parents=True)
            source = root / 'input.json'
            raw = vector['text'].encode('utf-8')
            source.write_bytes(raw)
            packet = json.loads(raw)
            target = packet['project'] or 'mdviewer'
            assert intake.parse_handoff(source) == packet
            before = file_state(root)
            call = lambda apply=False, demo=True: intake.run(source, target, 'conformance', root, True, apply, demo)
            must_refuse(lambda: call(demo=False))
            assert file_state(root) == before
            preview = call()
            assert preview['status'] == 'new' and file_state(root) == before
            assert preview['outcome']['probes'] == []
            assert 'status: proposed\n' in preview['item'] and 'external_actions: none\n' in preview['item']
            assert json.dumps(packet['evidence'], indent=2, ensure_ascii=True) in preview['item']
            written = call(apply=True)
            assert written['work'] == preview['work']
            folder = root / 'campaigns/active/conformance/work-items'
            assert sorted(p.name for p in folder.iterdir()) == ['PO-001.md', 'PO-001.outcome.json']
            markdown = (folder / 'PO-001.md').read_bytes()
            assert markdown == preview['item'].encode('utf-8')
            sidecar = intake.outcomes.validate_file(folder / 'PO-001.outcome.json')
            assert sidecar == preview['outcome']
            receipt = sidecar['sightings'][0]
            assert receipt['signal_sha256'] == vector['signalSha256']
            assert receipt['reviewed_file_sha256'] == vector['fileSha256']
            assert receipt['mode'] == 'demo' and receipt['target_repository'] == target
            before = file_state(root)
            assert call()['status'] == 'duplicate' and file_state(root) == before
            assert call(apply=True)['status'] == 'duplicate'
            sidecar = intake.outcomes.validate_file(folder / 'PO-001.outcome.json')
            assert len(sidecar['sightings']) == 2 and sidecar['probes'] == []
            assert (folder / 'PO-001.md').read_bytes() == markdown
            assert len(list(folder.iterdir())) == 2
            seen += 1
        # Strict JSON rejection must happen through the actual intake parser, not json.loads alone.
        raw = corpus['cases'][0]['text'].encode('utf-8')
        ambiguous = raw.replace(b'"mode": "demo"', b'"mode": "live", "mode": "demo"')
        must_refuse(lambda: intake._parse_handoff(ambiguous))
        forbidden = raw.replace(b'"evidence": {', b'"evidence": {"__proto__": {},')
        must_refuse(lambda: intake._parse_handoff(forbidden))
    return {'nativePreviewApplyCases': seen, 'strictJsonRejections': 2}


def revision(directory):
    value = subprocess.check_output(['git', '-C', str(directory), 'rev-parse', 'HEAD'], text=True, timeout=10).strip()
    assert re.fullmatch('[0-9a-f]{40}', value)
    return value


def run(args):
    consumer = args.consumer.resolve()
    assert revision(consumer) == args.consumer_sha, 'Consumer checkout differs from the reviewed pin'
    producer_sha = revision(ROOT.parent)
    raw_corpus = (ROOT / 'examples/handoff-fixtures.synthetic.json').read_bytes()
    assert hashlib.sha256(raw_corpus).hexdigest() == CORPUS_HASH, 'Conformance corpus bytes changed; review the compatibility baseline'
    corpus = json.loads(raw_corpus)
    assert corpus['synthetic'] is True and len(corpus['cases']) == 12
    intake = load_module(consumer / 'scripts/intake.py', 'pulseboard_native_intake_proof')
    # Fail on accidental probe execution or egress. Git revision reads happened before installing this hook.
    def no_external_actions(event, _args):
        if event in ('subprocess.Popen', 'os.system', 'os.posix_spawn', 'socket.connect', 'socket.bind'):
            raise AssertionError('Native conformance attempted an external action: ' + event)
    sys.addaudithook(no_external_actions)
    results = {**check_wire(intake.native, corpus), **check_intake(intake, corpus)}
    receipt = {'schema': 'pulseboard.native-conformance/1', 'result': 'passed',
               'producerRevision': producer_sha, 'consumerRevision': args.consumer_sha,
               'corpusSha256': CORPUS_HASH, 'os': platform.system(), 'python': platform.python_version(),
               **results, 'scope': 'Native parser and temporary proposed work items only; not Taskdeck, installed services, probes or execution.'}
    text = json.dumps(receipt, indent=2) + '\n'
    if args.receipt:
        args.receipt.write_text(text, encoding='utf-8', newline='\n')
    print(text, end='')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--consumer', type=Path, required=True)
    parser.add_argument('--consumer-sha', required=True)
    parser.add_argument('--receipt', type=Path)
    run(parser.parse_args())
