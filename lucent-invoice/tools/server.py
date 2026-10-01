#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lucent 請求書管理の起動用サーバー（Mac の中で動く）。

- 請求書管理の画面を http://localhost:8787 で開く
- データ（請求書・見積書・納品書・取引先・設定）を ~/.lucent-invoice/data.json に保存し、
  Mac とスマホで同じデータを使えるようにする
- スマホからは同じWi-Fiで http://<MacのIP>:8787 を開き、暗証番号（PIN）でログインする
  （PIN を設定するまではスマホからは使えない）
- 画面の「MakeLeapsと同期」ボタンから MakeLeaps のデータを取りに行く
- Gmail（アプリパスワード）を設定すると、画面から請求書PDFをメールで直接送れる

認証情報・データはすべて ~/.lucent-invoice/ に保存（本人だけ読める権限）。GitHub には上がらない。
"""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import posixpath
import secrets
import shutil
import smtplib
import socket
import sys
import threading
import time
import urllib.parse
import webbrowser
from email.header import Header
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import makeleaps_export as ml  # noqa: E402

PORT = int(os.environ.get("LUCENT_PORT", "8787"))
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONF_DIR = os.path.expanduser("~/.lucent-invoice")
CRED_FILE = os.path.join(CONF_DIR, "makeleaps.json")
CONF_FILE = os.path.join(CONF_DIR, "config.json")   # PIN・ログイン中の端末
MAIL_FILE = os.path.join(CONF_DIR, "mail.json")     # Gmail 送信設定
DATA_FILE = os.path.join(CONF_DIR, "data.json")     # 共有データ本体
BACKUP_DIR = os.path.join(CONF_DIR, "backups")
COOKIE = "lucent_session"
# テスト用：LUCENT_SMTP="host:port" を指定すると暗号化なしのSMTPに送る（通常は Gmail を使う）
SMTP_TEST = os.environ.get("LUCENT_SMTP", "")


def smtp_connect(timeout):
    if SMTP_TEST:
        host, port = SMTP_TEST.rsplit(":", 1)
        return smtplib.SMTP(host, int(port), timeout=timeout)
    return smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=timeout)

sync_lock = threading.Lock()
data_lock = threading.Lock()
fail_lock = threading.Lock()
login_fails = {}  # IP → (回数, 最終時刻)


# ---------- ファイル入出力（本人だけ読める権限で保存） ----------
def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    os.makedirs(CONF_DIR, mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)  # 書きかけで壊れないように置き換え


def load_creds():
    c = read_json(CRED_FILE, {})
    return c if c.get("client_id") and c.get("client_secret") else None


def load_conf():
    return read_json(CONF_FILE, {"pin_hash": "", "salt": "", "sessions": []})


def hash_pin(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000).hex()


# ---------- 共有データの統合（端末ごとの変更を、更新日時の新しい方で合わせる） ----------
def merge_state(a, b):
    """a = 保存済み, b = 端末から届いたデータ。同じ記録は updatedAt が新しい方（同時なら b）を採用"""
    a, b = a or {}, b or {}
    deleted = dict(a.get("deleted") or {})
    for k, v in (b.get("deleted") or {}).items():
        if v > deleted.get(k, ""):
            deleted[k] = v
    out = {"deleted": deleted}
    for coll in ("invoices", "customers"):
        recs = {}
        for rec in (a.get(coll) or []) + (b.get(coll) or []):
            rid = rec.get("id") if isinstance(rec, dict) else None
            if not rid:
                continue
            cur = recs.get(rid)
            if cur is None or (rec.get("updatedAt") or "") >= (cur.get("updatedAt") or ""):
                recs[rid] = rec
        out[coll] = [r for rid, r in recs.items() if not (rid in deleted and deleted[rid] >= (r.get("updatedAt") or ""))]
    sa, sb = a.get("settings") or {}, b.get("settings") or {}
    settings = dict(sb if (sb.get("updatedAt") or "") >= (sa.get("updatedAt") or "") else sa)
    # 採番・最終同期は大きい方を残す（別々の端末で作っても番号がかぶらないように）
    for k in ("nextNumber", "nextQuoteNumber", "nextDeliveryNumber"):
        vals = [v for v in (sa.get(k), sb.get(k)) if isinstance(v, int)]
        if vals:
            settings[k] = max(vals)
    for k in ("lastMakeLeapsImport",):
        vals = [v for v in (sa.get(k), sb.get(k)) if v]
        if vals:
            settings[k] = max(vals)
    out["settings"] = settings
    return out


def load_data():
    return read_json(DATA_FILE, {"rev": 0, "state": None})


def save_data(state, rev):
    # 1日1回、前日までのデータを控えとして残す（最大30日分）
    if os.path.exists(DATA_FILE):
        os.makedirs(BACKUP_DIR, mode=0o700, exist_ok=True)
        bk = os.path.join(BACKUP_DIR, f"data-{dt.date.today():%Y%m%d}.json")
        if not os.path.exists(bk):
            shutil.copy2(DATA_FILE, bk)
            for old in sorted(os.listdir(BACKUP_DIR))[:-30]:
                os.remove(os.path.join(BACKUP_DIR, old))
    write_json(DATA_FILE, {"rev": rev, "state": state, "savedAt": dt.datetime.now().isoformat(timespec="seconds")})


def lan_ips():
    """スマホから繋ぐためのMacのIPアドレス"""
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]) and "/api/data" not in str(args[0]):
            sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # 古い画面がキャッシュに残らないように
        super().end_headers()

    # ---------- 認証 ----------
    def _is_local(self):
        """このMac自身の画面からのアクセスか（DNSリバインディング対策でHostも確認）"""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        return self.client_address[0] in ("127.0.0.1", "::1") and host in ("localhost", "127.0.0.1")

    def _session(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE:
                return v
        return ""

    def _authed(self):
        if self._is_local():
            return True
        tok = self._session()
        return bool(tok) and any(hmac.compare_digest(tok, s) for s in load_conf().get("sessions", []))

    def _check(self, local_only=False):
        """API呼び出しの可否。POSTは画面からの呼び出しに限定（他サイトからの悪用防止）"""
        if self.command == "POST" and self.headers.get("X-Lucent") != "1":
            self._json({"error": "forbidden"}, 403)
            return False
        if local_only and not self._is_local():
            self._json({"error": "この操作はMacの画面からだけできます"}, 403)
            return False
        if not self._authed():
            self._json({"error": "login", "pinSet": bool(load_conf().get("pin_hash"))}, 401)
            return False
        return True

    # ---------- 共通 ----------
    def _json(self, obj, code=200, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 30 * 1024 * 1024:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    # ---------- GET ----------
    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/"):
            if path == "/api/auth":
                conf = load_conf()
                return self._json({"local": self._is_local(), "authed": self._authed(), "pinSet": bool(conf.get("pin_hash"))})
            if not self._check():
                return
            if path == "/api/status":
                mail = read_json(MAIL_FILE, {})
                return self._json({"server": True, "configured": bool(load_creds()), "mail": mail.get("user", ""), "local": self._is_local()})
            if path == "/api/data":
                with data_lock:
                    return self._json(load_data())
            if path == "/api/network":
                conf = load_conf()
                return self._json({"ips": lan_ips(), "port": PORT, "hostname": socket.gethostname(),
                                   "pinSet": bool(conf.get("pin_hash")), "devices": len(conf.get("sessions", []))})
            if path == "/api/inspect":
                return self._inspect()
            return self._json({"error": "not found"}, 404)
        p = posixpath.normpath(urllib.parse.unquote(path))
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

    # ---------- POST ----------
    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/login":
            return self._login()
        if path in ("/api/credentials", "/api/pin", "/api/mail-settings"):
            if not self._check(local_only=True):
                return
        elif not self._check():
            return
        body = self._body()

        if path == "/api/data":
            with data_lock:
                cur = load_data()
                merged = merge_state(cur.get("state"), body.get("state"))
                rev = cur.get("rev", 0) + 1
                save_data(merged, rev)
            return self._json({"rev": rev, "state": merged})

        if path == "/api/pin":
            pin = str(body.get("pin") or "").strip()
            if pin and not (pin.isdigit() and 4 <= len(pin) <= 8):
                return self._json({"error": "暗証番号は4〜8桁の数字にしてください"}, 400)
            salt = secrets.token_hex(8)
            # PINを変えたら、ログイン済みのスマホは全部ログアウトさせる
            write_json(CONF_FILE, {"pin_hash": hash_pin(pin, salt) if pin else "", "salt": salt if pin else "", "sessions": []})
            return self._json({"ok": True, "pinSet": bool(pin)})

        if path == "/api/mail-settings":
            user, pw = (body.get("user") or "").strip(), (body.get("password") or "").replace(" ", "").strip()
            if not user:
                write_json(MAIL_FILE, {})
                return self._json({"ok": True})
            try:
                with smtp_connect(20) as s:
                    if not SMTP_TEST:
                        s.login(user, pw)
            except Exception as e:
                return self._json({"error": f"Gmailにログインできませんでした。アドレスとアプリパスワードを確認してください（{e.__class__.__name__}）"}, 400)
            write_json(MAIL_FILE, {"user": user, "password": pw, "from_name": (body.get("from_name") or "").strip()})
            return self._json({"ok": True})

        if path == "/api/send-mail":
            return self._send_mail(body)

        if path == "/api/credentials":
            cid, secret = (body.get("client_id") or "").strip(), (body.get("client_secret") or "").strip()
            if not cid or not secret:
                return self._json({"error": "クライアントIDとシークレットを入力してください"}, 400)
            try:
                ml.Client(cid, secret).auth()  # 正しいか先に確かめる
            except ml.MLError as e:
                return self._json({"error": str(e)}, 400)
            write_json(CRED_FILE, {"client_id": cid, "client_secret": secret})
            return self._json({"ok": True})

        if path == "/api/sync":
            creds = load_creds()
            if not creds:
                return self._json({"error": "MakeLeapsの接続設定がまだです（Macの設定画面で入力してください）"}, 400)
            since = None if body.get("all") else (body.get("since") or f"{dt.date.today().year}-01-01")
            if not sync_lock.acquire(blocking=False):
                return self._json({"error": "同期中です。少し待ってからもう一度押してください"}, 409)
            try:
                out, diag, _ = ml.export(ml.Client(creds["client_id"], creds["client_secret"]), since, log=lambda m: print(m, file=sys.stderr))
                out["diagnostics"] = diag
                print(f"同期完了：請求書 {diag['invoices']} 件／明細あり {diag['withItems']} 件", file=sys.stderr)
                return self._json(out)
            except ml.MLError as e:
                return self._json({"error": str(e)}, 502)
            except Exception as e:  # 想定外のエラーも画面に出す
                return self._json({"error": f"同期中にエラーが発生しました：{e}"}, 500)
            finally:
                sync_lock.release()

        return self._json({"error": "not found"}, 404)

    def _login(self):
        if self.headers.get("X-Lucent") != "1":
            return self._json({"error": "forbidden"}, 403)
        ip = self.client_address[0]
        with fail_lock:
            n, last = login_fails.get(ip, (0, 0))
            if n >= 5 and time.time() - last < 300:
                return self._json({"error": "失敗が続いたため5分間ログインできません"}, 429)
        conf = load_conf()
        if not conf.get("pin_hash"):
            return self._json({"error": "スマホ共有がオフです。Macの設定画面で暗証番号を設定してください"}, 403)
        pin = str(self._body().get("pin") or "").strip()
        if not hmac.compare_digest(hash_pin(pin, conf.get("salt", "")), conf["pin_hash"]):
            with fail_lock:
                login_fails[ip] = (n + 1, time.time())
            time.sleep(1)
            return self._json({"error": "暗証番号が違います"}, 401)
        with fail_lock:
            login_fails.pop(ip, None)
        tok = secrets.token_urlsafe(32)
        conf["sessions"] = (conf.get("sessions") or [])[-19:] + [tok]
        write_json(CONF_FILE, conf)
        cookie = f"{COOKIE}={tok}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict"
        return self._json({"ok": True}, headers={"Set-Cookie": cookie})

    def _send_mail(self, body):
        mail = read_json(MAIL_FILE, {})
        if not mail.get("user"):
            return self._json({"error": "メール送信の設定がまだです（Macの設定画面でGmailを設定してください）"}, 400)
        to = [x.strip() for x in str(body.get("to") or "").replace("、", ",").split(",") if x.strip()]
        if not to:
            return self._json({"error": "送信先のメールアドレスを入力してください"}, 400)
        msg = MIMEMultipart()
        msg["From"] = formataddr((str(Header(mail.get("from_name") or "", "utf-8")), mail["user"])) if mail.get("from_name") else mail["user"]
        msg["To"] = ", ".join(to)
        if body.get("bcc_self"):
            msg["Bcc"] = mail["user"]
        msg["Subject"] = str(Header(body.get("subject") or "", "utf-8"))
        msg["Date"] = formatdate(localtime=True)
        msg.attach(MIMEText(body.get("text") or "", "plain", "utf-8"))
        if body.get("pdf"):
            part = MIMEApplication(base64.b64decode(body["pdf"]), _subtype="pdf")
            part.add_header("Content-Disposition", "attachment", filename=("utf-8", "", body.get("filename") or "document.pdf"))
            msg.attach(part)
        try:
            with smtp_connect(30) as s:
                if not SMTP_TEST:
                    s.login(mail["user"], mail["password"])
                s.send_message(msg)
        except Exception as e:
            return self._json({"error": f"送信できませんでした：{e}"}, 502)
        return self._json({"ok": True})


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
    # スマホから繋げるよう全てのネットワークで待ち受ける（PIN未設定ならスマホからは使えない）
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("=" * 50)
    print(" Lucent 請求書管理 を起動しました")
    print(f" Mac  : {url}")
    for ip in lan_ips():
        print(f" スマホ: http://{ip}:{PORT}/ （同じWi-Fi・要暗証番号）")
    print(" ※このウィンドウを閉じると使えなくなります（終了は control + C）")
    print("=" * 50)
    if os.environ.get("LUCENT_NO_BROWSER") != "1":
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n終了しました。")


if __name__ == "__main__":
    main()
