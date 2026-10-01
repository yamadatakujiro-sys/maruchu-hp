#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MakeLeaps の請求書データを「Lucent 請求書管理」に取り込める JSON に書き出すスクリプト。

使い方（Mac のターミナル）:
    cd ~/maruchu-hp/lucent-invoice/tools
    python3 makeleaps_export.py              # 今年の請求書を書き出す
    python3 makeleaps_export.py --since 2025-01-01
    python3 makeleaps_export.py --all        # 全期間

  → 同じフォルダに makeleaps-export.json ができるので、
    請求書管理の「設定 → MakeLeapsから取り込む」で読み込む。

認証情報:
  MakeLeaps の「APIキー」画面のクライアントID／クライアントシークレットを使う。
  環境変数 MAKELEAPS_CLIENT_ID / MAKELEAPS_CLIENT_SECRET があればそれを、無ければ実行時に聞く。
  ※認証情報はどこにも保存しない。

Python 3 の標準ライブラリだけで動く（追加インストール不要）。
"""
import argparse
import base64
import datetime as dt
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("MAKELEAPS_API_BASE", "https://api.makeleaps.com")  # テスト用に差し替え可
TOKEN_URL = API + "/user/oauth2/token/"


# ---------- HTTP ----------
class Client:
    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token = None

    def auth(self):
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        req = urllib.request.Request(
            TOKEN_URL,
            data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
            headers={"Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                self.token = json.load(r)["access_token"]
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            sys.exit(f"認証に失敗しました（HTTP {e.code}）。クライアントID／シークレットを確認してください。\n{body}")

    def get(self, url, retry=5):
        if not url.startswith("http"):
            url = API + url
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + self.token, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # 1分120回の制限に当たったら Retry-After 秒待って再試行
            if e.code == 429 and retry > 0:
                wait = int(e.headers.get("Retry-After") or 30)
                print(f"  …アクセス制限のため {wait} 秒待機します", file=sys.stderr)
                time.sleep(wait)
                return self.get(url, retry - 1)
            body = e.read().decode("utf-8", "replace")[:300]
            sys.exit(f"取得に失敗しました（HTTP {e.code}）: {url}\n{body}")

    def get_all(self, url):
        """ページングをたどって全件を返す"""
        items = []
        while url:
            data = self.get(url)
            resp = data.get("response", data) if isinstance(data, dict) else data
            if isinstance(resp, list):
                items.extend(resp)
            elif isinstance(resp, dict) and isinstance(resp.get("results"), list):
                items.extend(resp["results"])
            meta = data.get("meta", {}) if isinstance(data, dict) else {}
            url = meta.get("next_page") or meta.get("next") or (data.get("next") if isinstance(data, dict) else None)
        return items


# ---------- 値の取り出し（API の項目名の揺れに備えて複数候補を見る） ----------
def pick(d, *keys, default=""):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d[k]
    return default


def money(v):
    """"80000" / "80000.00" / {"amount": "80000"} などを整数円に"""
    if isinstance(v, dict):
        v = pick(v, "amount", "value", default=0)
    try:
        return int(round(float(str(v).replace(",", ""))))
    except (TypeError, ValueError):
        return 0


def to_date(v):
    return str(v)[:10] if v else ""


def find_partner_mid(cli):
    """自社（partner）の mid を探す"""
    for path in ("/api/partner/", "/api/"):
        try:
            data = cli.get(path)
        except SystemExit:
            continue
        found = []

        def walk(o):
            if isinstance(o, dict):
                if o.get("mid") and "/partner/" in str(o.get("url", "")):
                    found.append(o)
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(data)
        if found:
            if len(found) > 1:
                print("複数の組織が見つかりました。最初の組織を使います（--mid で指定可）:", file=sys.stderr)
                for p in found:
                    print(f"  {p.get('mid')}  {p.get('name', '')}", file=sys.stderr)
            return found[0]["mid"]
    sys.exit("組織（partner）の mid が見つかりませんでした。--mid で指定してください。")


def is_paid(doc):
    for k in ("paid", "is_paid", "payment_completed"):
        if doc.get(k) is True:
            return True
    for k in ("payment_status", "status", "paid_status"):
        if str(doc.get(k, "")).lower() in ("paid", "payment_complete", "completed", "入金済"):
            return True
    return False


def convert(docs, clients_by_url, since, until):
    customers, invoices = {}, []
    skipped = 0
    for d in docs:
        dtype = str(pick(d, "document_type", "type")).lower()
        if dtype and dtype != "invoice":
            continue
        date = to_date(pick(d, "date", "issue_date", "created"))
        if since and date < since or until and date > until:
            continue
        if d.get("deleted") or d.get("is_deleted") or str(d.get("status", "")).lower() in ("cancelled", "canceled", "void"):
            skipped += 1
            continue

        c = d.get("client")
        cobj = clients_by_url.get(c) if isinstance(c, str) else (c if isinstance(c, dict) else {})
        cobj = cobj or {}
        name = pick(cobj, "display_name", "name", "company_name") or pick(d, "client_name", "client_display_name") or "（取引先不明）"
        cust = customers.setdefault(name, {
            "name": name,
            "honorific": "御中",
            "postal": pick(cobj, "postal_code", "zipcode"),
            "address": pick(cobj, "address", "address_line_1"),
            "tel": pick(cobj, "phone", "tel", "phone_number"),
            "fax": pick(cobj, "fax", "fax_number"),
            "externalId": pick(cobj, "mid"),
        })

        items = []
        for ln in d.get("lines") or d.get("items") or []:
            kind = str(ln.get("kind", "normal")).lower()
            if kind not in ("normal", "simple", "item", ""):
                continue  # 小計行・見出し行などは除外
            desc = pick(ln, "description", "name", "title")
            qty = ln.get("quantity", 1)
            try:
                qty_f = float(qty)
            except (TypeError, ValueError):
                qty_f = 1
            price = money(pick(ln, "price", "unit_price", default=0))
            if not desc and not price:
                continue
            # 数量が小数の場合は金額を単価に寄せて1個扱いにする
            if qty_f != int(qty_f):
                price, qty_f = int(round(price * qty_f)), 1
            items.append({"date": "", "car": "", "part": desc, "qty": int(qty_f), "price": price})

        subtotal = money(pick(d, "subtotal", "total_excluding_tax", default=0))
        tax = money(pick(d, "tax", "tax_total", "total_tax", default=0))
        total = money(pick(d, "total", "total_including_tax", default=subtotal + tax))
        paid = is_paid(d)
        invoices.append({
            "externalId": pick(d, "mid") or pick(d, "url"),
            "source": "makeleaps",
            "number": str(pick(d, "document_number", "number")),
            "issueDate": date,
            "dueDate": to_date(pick(d, "due_date", "payment_due_date")),
            "customerName": name,
            "honorific": cust["honorific"],
            "customerPostal": cust["postal"],
            "customerAddress": cust["address"],
            "customerTel": cust["tel"],
            "customerFax": cust["fax"],
            "items": items,
            # MakeLeaps 上の金額をそのまま保持（内税・値引きなどで明細から再計算すると合わない場合に備える）
            "importedTotals": {"subtotal": subtotal, "tax": tax, "total": total},
            "notes": pick(d, "note", "notes", "memo"),
            "status": "paid" if paid else "issued",
            "paidDate": to_date(pick(d, "paid_date", "payment_date")) if paid else "",
            "paidAmount": total if paid else "",
            "memo": "MakeLeapsから取り込み",
        })
    return list(customers.values()), invoices, skipped


def main():
    ap = argparse.ArgumentParser(description="MakeLeaps → Lucent請求書管理 の書き出し")
    ap.add_argument("--since", help="この日以降（YYYY-MM-DD）。省略時は今年の1月1日")
    ap.add_argument("--until", help="この日まで（YYYY-MM-DD）")
    ap.add_argument("--all", action="store_true", help="全期間を書き出す")
    ap.add_argument("--mid", help="組織（partner）の mid を直接指定")
    ap.add_argument("--out", default="makeleaps-export.json")
    ap.add_argument("--raw", action="store_true", help="APIの生データも makeleaps-raw.json に保存（項目の確認用）")
    a = ap.parse_args()

    since = None if a.all else (a.since or f"{dt.date.today().year}-01-01")
    cid = os.environ.get("MAKELEAPS_CLIENT_ID") or input("MakeLeaps クライアントID: ").strip()
    secret = os.environ.get("MAKELEAPS_CLIENT_SECRET") or getpass.getpass("MakeLeaps クライアントシークレット（入力は表示されません）: ").strip()

    cli = Client(cid, secret)
    print("認証中…")
    cli.auth()
    mid = a.mid or find_partner_mid(cli)
    print(f"組織 mid: {mid}")

    print("取引先を取得中…")
    clients = cli.get_all(f"/api/partner/{mid}/client/")
    clients_by_url = {c.get("url"): c for c in clients if isinstance(c, dict)}
    print(f"  {len(clients)} 件")

    print("書類を取得中…（件数が多いと数分かかります）")
    docs = cli.get_all(f"/api/partner/{mid}/document/")
    print(f"  {len(docs)} 件")

    if a.raw:
        with open("makeleaps-raw.json", "w", encoding="utf-8") as f:
            json.dump({"clients": clients, "documents": docs}, f, ensure_ascii=False, indent=2)
        print("生データを makeleaps-raw.json に保存しました（顧客情報を含むので取り扱い注意）")

    customers, invoices, skipped = convert(docs, clients_by_url, since, a.until)
    out = {
        "app": "lucent-invoice", "kind": "makeleaps-import",
        "exportedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "range": {"since": since, "until": a.until},
        "customers": customers, "invoices": invoices,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    total = sum(i["importedTotals"]["total"] for i in invoices)
    unpaid = sum(i["importedTotals"]["total"] for i in invoices if i["status"] != "paid")
    print("\n===== 書き出し完了 =====")
    print(f"期間        : {since or '全期間'} 〜 {a.until or '今日'}")
    print(f"請求書      : {len(invoices)} 件（取消など除外 {skipped} 件）")
    print(f"売上合計    : ¥{total:,}")
    print(f"うち未入金  : ¥{unpaid:,}  ※入金状態が取れない場合は全件「未入金」になります")
    print(f"取引先      : {len(customers)} 社")
    print(f"ファイル    : {os.path.abspath(a.out)}")
    print("→ 請求書管理の「設定 → MakeLeapsから取り込む」で読み込んでください。")


if __name__ == "__main__":
    main()
