#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lucent 請求書管理の起動用サーバー（Mac の中だけで動く）。

- 請求書管理の画面を http://localhost:8787 で開く
- 画面の「MakeLeapsと同期」ボタンから MakeLeaps のデータを取りに行く
  （ブラウザから MakeLeaps へ直接は繋げないため、ここが中継する）

MakeLeaps の認証情報は ~/.lucent-invoice/makeleaps.json に保存する（本人だけ読める権限）。
リポジトリの外なので GitHub に上がることはない。

普段は「Lucent請求書.command」をダブルクリックすれば、このサーバーが起動してブラウザが開く。
"""
import datetime as dt
import json
import os
import posixpath
import socket
import sys
import threading
import urllib.parse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import makeleaps_export as ml  # noqa: E402

PORT = int(os.environ.get("LUCENT_PORT", "8787"))
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONF_DIR = os.path.expanduser("~/.lucent-invoice")
CRED_FILE = os.path.join(CONF_DIR, "makeleaps.json")
sync_lock = threading.Lock()


def load_creds():
    try:
        with open(CRED_FILE, encoding="utf-8") as f:
            c = json.load(f)
        if c.get("client_id") and c.get("client_secret"):
            return c
    except (OSError, ValueError):
        pass
    return None


def save_creds(cid, secret):
    os.makedirs(CONF_DIR, mode=0o700, exist_ok=True)
    fd = os.open(CRED_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"client_id": cid, "client_secret": secret}, f)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]):
            sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        # 古い画面がキャッシュに残らないようにする
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- 安全対策：このMacの画面からの呼び出し以外は受け付けない ----
    def _allowed(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("localhost", "127.0.0.1"):
            return False
        if self.command == "POST" and self.headers.get("X-Lucent") != "1":
            return False
        return True

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def do_GET(self):
        if self.path.startswith("/api/"):
            if not self._allowed():
                return self._json({"error": "forbidden"}, 403)
            if self.path == "/api/status":
                return self._json({"server": True, "configured": bool(load_creds())})
            if self.path.startswith("/api/inspect?"):
                return self._inspect()
            return self._json({"error": "not found"}, 404)
        p = posixpath.normpath(urllib.parse.unquote(self.path.split("?")[0]))
        if p.startswith("/tools") or any(seg.startswith(".") for seg in p.split("/") if seg):
            return self.send_error(404)  # スクリプトや隠しファイルは配信しない
        return super().do_GET()

    def _inspect(self):
        """1件の請求書について MakeLeaps 上の明細をそのまま返す（内訳が取れない原因調査用）"""
        creds = load_creds()
        if not creds:
            return self._json({"error": "MakeLeapsの接続設定がまだです"}, 400)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        doc = (q.get("doc") or [""])[0]
        try:
            cli = ml.Client(creds["client_id"], creds["client_secret"])
            cli.auth()
            url = doc if doc.startswith("http") else f"/api/partner/{ml.find_partner_mid(cli)}/document/{doc}/"
            detail = ml.unwrap(cli.get(url))
            lines = ml.resolve_lineitems(cli, detail if isinstance(detail, dict) else {})
            keys = sorted(detail.keys()) if isinstance(detail, dict) else []
            return self._json({
                "documentKeys": [k for k in keys if any(w in k for w in ("line", "item", "group", "total"))],
                "lineitemsRaw": detail.get("lineitems") if isinstance(detail, dict) else None,
                "resolved": lines,
            })
        except ml.MLError as e:
            return self._json({"error": str(e)}, 502)

    def do_POST(self):
        if not self._allowed():
            return self._json({"error": "forbidden"}, 403)
        body = self._body()

        if self.path == "/api/credentials":
            cid, secret = (body.get("client_id") or "").strip(), (body.get("client_secret") or "").strip()
            if not cid or not secret:
                return self._json({"error": "クライアントIDとシークレットを入力してください"}, 400)
            try:
                ml.Client(cid, secret).auth()  # 正しいか先に確かめる
            except ml.MLError as e:
                return self._json({"error": str(e)}, 400)
            save_creds(cid, secret)
            return self._json({"ok": True})

        if self.path == "/api/sync":
            creds = load_creds()
            if not creds:
                return self._json({"error": "MakeLeapsの接続設定がまだです（設定画面で入力してください）"}, 400)
            since = None if body.get("all") else (body.get("since") or f"{dt.date.today().year}-01-01")
            if not sync_lock.acquire(blocking=False):
                return self._json({"error": "同期中です。少し待ってからもう一度押してください"}, 409)
            try:
                out, diag, _ = ml.export(ml.Client(creds["client_id"], creds["client_secret"]), since, log=lambda m: print(m, file=sys.stderr))
                out["diagnostics"] = diag
                print(f"同期完了：請求書 {diag['invoices']} 件／明細あり {diag['withItems']} 件／診断 {diag['lineitems']}", file=sys.stderr)
                return self._json(out)
            except ml.MLError as e:
                return self._json({"error": str(e)}, 502)
            except Exception as e:  # 想定外のエラーも画面に出す
                return self._json({"error": f"同期中にエラーが発生しました：{e}"}, 500)
            finally:
                sync_lock.release()

        return self._json({"error": "not found"}, 404)


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    url = f"http://localhost:{PORT}/"
    if port_in_use(PORT):
        # すでに起動していればブラウザを開くだけ
        print("すでに起動しています。ブラウザで開きます。")
        webbrowser.open(url)
        return
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("=" * 50)
    print(" Lucent 請求書管理 を起動しました")
    print(f" {url}")
    print(" ※このウィンドウを閉じると同期ボタンが使えなくなります")
    print("   （終了するときは このウィンドウで control + C）")
    print("=" * 50)
    if os.environ.get("LUCENT_NO_BROWSER") != "1":
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n終了しました。")


if __name__ == "__main__":
    main()
