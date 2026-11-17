#!/usr/bin/env python3
"""Persistent yt-dlp extraction worker for OudBot (T19b).

Protocol: one JSON object per line on stdin, one JSON reply per line on stdout.
Request: {"id": n, "args": ["--opt", ..., url], "out": "/abs/path.json"}
Reply:   {"id": n, "ok": true}  or  {"id": n, "ok": false, "error": "<short>"}

argv[1] is the yt-dlp zipapp path: it goes on sys.path and `import yt_dlp` pulls
in the real module (the youtube-dl-exec binary is a zipapp, so that works).
Stdlib only besides yt_dlp. stdout is the protocol channel, so yt-dlp is
silenced via opts. A bad url yields ok:false and never kills the worker.
"""
import json
import os
import sys


class _SilentLog:
    """yt-dlp logger that discards everything (stdout is ours)."""

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass


def handle(req, yt_dlp):
    """Process one decoded request dict; returns a reply dict (no throw)."""
    rid = req.get('id')
    args = [a for a in (req.get('args') or []) if isinstance(a, str)]
    out = req.get('out')
    if not args or not isinstance(out, str) or not out:
        return {'id': rid, 'ok': False, 'error': 'bad request'}
    url = args[-1]
    args = args[:-1]
    opts = yt_dlp.parse_options(args).ydl_opts
    # stdout is the protocol channel: silence yt-dlp completely.
    opts['quiet'] = True
    opts['no_warnings'] = True
    opts['logger'] = _SilentLog()
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    info = ydl.sanitize_info(info)
    if not isinstance(info, dict):
        return {'id': rid, 'ok': False, 'error': 'no info'}
    if info.get('is_live') or info.get('_type') == 'playlist':
        return {'id': rid, 'ok': False, 'error': 'live or playlist'}
    # 0o600 mode so the info file never exposes the metadata to other local
    # users (same posture as the cold CLI path).
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(info, f)
    return {'id': rid, 'ok': True}


def main():
    yt_dlp = None
    if len(sys.argv) > 1:
        sys.path.insert(0, sys.argv[1])
        yt_dlp = __import__('yt_dlp')
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        if not isinstance(req, dict):
            continue
        reply = None
        if yt_dlp is None:
            reply = {'id': req.get('id'), 'ok': False, 'error': 'yt_dlp unavailable'}
        else:
            try:
                reply = handle(req, yt_dlp)
            except (KeyboardInterrupt, SystemExit):
                raise
            except BaseException as exc:
                reply = {'id': req.get('id'), 'ok': False, 'error': str(exc)[:200]}
        sys.stdout.write(json.dumps(reply) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()

