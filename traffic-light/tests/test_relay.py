#!/usr/bin/env python3
"""Tests for the relay + local aggregation. Run: python3 -m pytest, or
python3 tests/test_relay.py  (plain unittest, no dependencies)."""
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))


class FakeResp:
    def __init__(self, payload, status=200):
        self._raw = json.dumps(payload).encode()
        self.status = status

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.environ["AGENT_TRAFFIC_LIGHT_DIR"] = self.tmp
        os.environ["TRAFFIC_LIGHT_LABEL"] = "testbox"
        os.environ.pop("TRAFFIC_LIGHT_RELAY_STALE", None)
        os.environ.pop("TRAFFIC_LIGHT_GITHUB_TOKEN", None)
        os.environ.pop("TRAFFIC_LIGHT_GIST_ID", None)
        # reload module fresh so BASE_DIR picks up the temp dir
        for m in ("relay",):
            sys.modules.pop(m, None)
        import relay
        self.relay = relay
        self.calls = []

        def fake_urlopen(req, timeout=15):
            self.calls.append((req.method, req.full_url,
                               json.loads(req.data) if req.data else None))
            if req.method == "GET":
                return FakeResp(self.gist_payload())
            return FakeResp({"id": "gid123"})
        relay._urlopen = fake_urlopen

    def gist_payload(self):
        return getattr(self, "_gist", {"files": {}})

    def cfg(self):
        self.relay.save_config("ghp_test", "gid123")

    # ---- pure logic -----------------------------------------------------
    def test_normalize(self):
        r = self.relay
        self.assertEqual([r.normalize(w) for w in
                          ("coding", "approval", "done", "", "?", "GREEN")],
                         ["red", "yellow", "green", "off", "off", "green"])

    def test_summarize_priority(self):
        now = time.time()
        entries = [("cloud", "green", now), ("mac", "red", now), ("ci", "yellow", now)]
        s = self.relay.summarize(entries)
        self.assertEqual(s["state"], "red")          # red wins
        self.assertEqual(s["count"], 3)
        self.assertEqual(s["sources"], ["ci", "cloud", "mac"])

    def test_summarize_staleness(self):
        old = time.time() - 100000
        s = self.relay.summarize([("cloud", "green", old)])
        self.assertEqual(s, {"state": "off", "count": 0, "sources": []})

    def test_parse_gist_files(self):
        payload = json.dumps({"state": "red", "ts": 123, "label": "cloud"})
        gist = {"files": {"tl-cloud-claude-abcd.json": {"content": payload},
                          "_keepalive.json": {"content": "{}"},
                          "unrelated.txt": {"content": "x"}}}
        entries = self.relay.parse_gist_files(gist)
        self.assertEqual(entries, [("cloud", "red", 123.0)])

    def test_key_format(self):
        os.environ["TRAFFIC_LIGHT_LABEL"] = "testbox"
        # no stdin session -> no suffix
        k = self.relay._key("claude")
        self.assertTrue(k.startswith("tl-testbox-claude"))
        self.assertTrue(k.endswith(".json"))

    # ---- push behaviour -------------------------------------------------
    def test_push_unconfigured_is_noop(self):
        self.assertFalse(self.relay.push("claude", "red"))
        self.assertEqual(self.calls, [])

    def test_push_writes_then_dedupes(self):
        self.cfg()
        self.assertTrue(self.relay.push("claude", "red"))     # 1st: writes
        self.assertEqual(len(self.calls), 1)
        method, url, body = self.calls[0]
        self.assertEqual(method, "PATCH")
        fname = next(iter(body["files"]))
        content = json.loads(body["files"][fname]["content"])
        self.assertEqual(content["state"], "red")
        self.assertEqual(content["label"], "testbox")
        # same state again -> no network (transition cache)
        self.assertFalse(self.relay.push("claude", "red"))
        self.assertEqual(len(self.calls), 1)
        # change -> writes again
        self.assertTrue(self.relay.push("claude", "green"))
        self.assertEqual(len(self.calls), 2)

    def test_push_off_deletes_file(self):
        self.cfg()
        self.relay.push("claude", "red")
        self.relay.push("claude", "off")
        _, _, body = self.calls[-1]
        fname = next(iter(body["files"]))
        self.assertIsNone(body["files"][fname])               # None => gist deletes it

    def test_fetch_aggregates(self):
        self.cfg()
        payload = json.dumps({"state": "yellow", "ts": time.time(), "label": "cloud"})
        self._gist = {"files": {"tl-cloud-claude-xy.json": {"content": payload}}}
        got = self.relay.fetch()
        self.assertEqual(got["state"], "yellow")
        self.assertEqual(got["count"], 1)
        self.assertEqual(got["sources"], ["cloud"])

    def test_setup_creates_gist_and_saves_config(self):
        gid = self.relay.setup("ghp_abc123")
        self.assertEqual(gid, "gid123")
        cfg = self.relay.load_config()
        self.assertEqual(cfg["gist_id"], "gid123")
        self.assertEqual(cfg["token"], "ghp_abc123")
        method, url, body = self.calls[-1]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/gists"))
        self.assertIn(self.relay.KEEPALIVE, body["files"])

    def test_fetch_network_error_is_safe(self):
        self.cfg()
        def boom(req, timeout=15):
            raise OSError("network down")
        self.relay._urlopen = boom
        self.assertEqual(self.relay.fetch(), {"state": "off", "count": 0, "sources": []})


class LocalAggregationTests(unittest.TestCase):
    """The local (file-based) path still works and matches relay semantics."""
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.environ["AGENT_TRAFFIC_LIGHT_DIR"] = self.tmp
        os.environ.pop("AGENT_TRAFFIC_LIGHT_STALE", None)
        sys.modules.pop("agent_state", None)
        import agent_state
        self.a = agent_state

    def test_priority_and_disconnect(self):
        a = self.a
        a.write_state("claude-aaa", "green")
        a.write_state("claude-bbb", "red")
        s = a.summary()
        self.assertEqual(s.state, "red")
        self.assertEqual(s.count, 2)
        a.write_state("claude-bbb", "off")   # disconnect one
        self.assertEqual(a.summary().count, 1)
        a.write_state("claude-aaa", "off")
        self.assertEqual(a.summary().state, "off")


if __name__ == "__main__":
    unittest.main(verbosity=2)
