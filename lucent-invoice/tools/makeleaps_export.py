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


class MLError(Exception):
    """MakeLeaps との通信エラー（画面にそのまま表示できる日本語メッセージ）"""


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
            raise MLError(f"認証に失敗しました（HTTP {e.code}）。クライアントID／シークレットを確認してください。\n{body}")

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
            raise MLError(f"取得に失敗しました（HTTP {e.code}）: {url}\n{body}")

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
# MakeLeaps は都道府県をローマ字（例：saitama）で返すので漢字に直す
PREFECTURES = {"hokkaido": "北海道", "aomori": "青森県", "iwate": "岩手県", "miyagi": "宮城県", "akita": "秋田県", "yamagata": "山形県", "fukushima": "福島県", "ibaraki": "茨城県", "tochigi": "栃木県", "gunma": "群馬県", "saitama": "埼玉県", "chiba": "千葉県", "tokyo": "東京都", "kanagawa": "神奈川県", "niigata": "新潟県", "toyama": "富山県", "ishikawa": "石川県", "fukui": "福井県", "yamanashi": "山梨県", "nagano": "長野県", "gifu": "岐阜県", "shizuoka": "静岡県", "aichi": "愛知県", "mie": "三重県", "shiga": "滋賀県", "kyoto": "京都府", "osaka": "大阪府", "hyogo": "兵庫県", "nara": "奈良県", "wakayama": "和歌山県", "tottori": "鳥取県", "shimane": "島根県", "okayama": "岡山県", "hiroshima": "広島県", "yamaguchi": "山口県", "tokushima": "徳島県", "kagawa": "香川県", "ehime": "愛媛県", "kochi": "高知県", "fukuoka": "福岡県", "saga": "佐賀県", "nagasaki": "長崎県", "kumamoto": "熊本県", "oita": "大分県", "miyazaki": "宮崎県", "kagoshima": "鹿児島県", "okinawa": "沖縄県"}


def prefecture_ja(v):
    key = str(v or "").strip().lower().replace("-ken", "").replace("-to", "").replace("-fu", "").replace(" ", "")
    key = {"hokkaidō": "hokkaido", "tōkyō": "tokyo", "kyōto": "kyoto", "ōsaka": "osaka", "hyōgo": "hyogo", "kōchi": "kochi", "ōita": "oita"}.get(key, key)
    return PREFECTURES.get(key, str(v or ""))


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
        except MLError:
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
    raise MLError("組織（partner）の mid が見つかりませんでした。")


def paid_date(doc):
    """MakeLeaps は入金済になると date_paid（または payment_date）に日付が入る"""
    return to_date(pick(doc, "date_paid", "payment_date", "paid_date"))


def is_paid(doc):
    if paid_date(doc):
        return True
    for k in ("paid", "is_paid", "payment_completed"):
        if doc.get(k) is True:
            return True
    for k in ("payment_status", "status", "paid_status"):
        if str(doc.get(k, "")).lower() in ("paid", "payment_complete", "completed", "入金済"):
            return True
    return False


def unwrap(data):
    """{"meta":…, "response": …} 形式なら中身を取り出す"""
    return data.get("response", data) if isinstance(data, dict) else data


def resolve_lineitems(cli, d):
    """明細を取り出す。MakeLeapsは明細がURL（別リソース）で返ることがあるので、その場合は取りに行く"""
    li = d.get("lineitems")
    diag = {"一覧の明細": type(li).__name__ + (f"({len(li)})" if isinstance(li, (list, str)) else "")}
    if not li and d.get("url"):
        # 一覧に明細が含まれない（空）場合は書類の詳細を取得
        detail = unwrap(cli.get(d["url"]))
        li = detail.get("lineitems") if isinstance(detail, dict) else None
        diag["詳細の明細"] = type(li).__name__ + (f"({len(li)})" if isinstance(li, (list, str)) else "")
        if isinstance(detail, dict) and not li:
            diag["詳細の項目名"] = sorted(k for k in detail.keys() if "line" in k or "item" in k)
    if not resolve_lineitems.diag:
        resolve_lineitems.diag = diag
    if isinstance(li, str):
        li = unwrap(cli.get(li))
        if isinstance(li, dict):
            li = li.get("results") or li.get("lineitems") or []
    out = []
    for x in li or []:
        if isinstance(x, str):
            x = unwrap(cli.get(x))
        elif isinstance(x, dict) and set(x.keys()) <= {"url", "mid"} and x.get("url"):
            x = unwrap(cli.get(x["url"]))
        if isinstance(x, dict):
            out.append(x)
    return out


resolve_lineitems.diag = None


def flatten_lines(lines):
    """グループ（税率ごと等）で入れ子になった明細を1列に並べる"""
    out = []
    for ln in lines or []:
        if not isinstance(ln, dict):
            continue
        children = next((ln[k] for k in ("lineitems", "items", "children", "sub_lineitems") if isinstance(ln.get(k), list)), None)
        if children:
            out.extend(flatten_lines(children))
        else:
            out.append(ln)
    return out


def line_to_item(ln):
    """MakeLeaps の明細1行 → アプリの明細1行（小計行は除外。品名だけの行は金額空欄で残す）"""
    kind = str(ln.get("kind", "")).lower()
    if kind in ("subtotal", "total"):
        return None
    desc = str(pick(ln, "description", "name", "title", "text", "label")).strip()
    try:
        qty_f = float(pick(ln, "quantity", "qty", default=1))
    except (TypeError, ValueError):
        qty_f = 1
    price = money(pick(ln, "price", "unit_price", "price_per_unit", "rate", default=0))
    if not price and pick(ln, "amount", "total", "subtotal"):
        price, qty_f = money(pick(ln, "amount", "total", "subtotal")), 1  # 単価が無ければ行金額を1個分として扱う
    if not desc and not price:
        return None
    if not price and kind in ("text", "heading", "header", "note", "comment"):
        return {"date": "", "car": "", "part": desc, "qty": 0, "price": 0}  # 見出し・メモ行
    # 数量が小数の場合は金額を単価に寄せて1個扱いにする
    if qty_f != int(qty_f):
        price, qty_f = int(round(price * qty_f)), 1
    return {"date": "", "car": "", "part": desc, "qty": int(qty_f), "price": price}


def convert(cli, docs, clients_by_url, since, until):
    customers, invoices = {}, []
    skipped = 0
    for d in docs:
        dtype = str(pick(d, "document_type", "type")).lower()
        if dtype and dtype != "invoice":
            continue
        date = to_date(pick(d, "date", "issue_date", "created"))
        if since and date < since or until and date > until:
            continue
        if d.get("date_cancelled") or d.get("date_removed") or d.get("deleted") or d.get("is_deleted") or str(d.get("status", "")).lower() in ("cancelled", "canceled", "void"):
            skipped += 1
            continue

        c = d.get("client")
        cobj = clients_by_url.get(c) if isinstance(c, str) else (c if isinstance(c, dict) else {})
        cobj = cobj or {}
        name = pick(cobj, "display_name", "name", "company_name") or pick(d, "recipient_name", "client_name") or "（取引先不明）"
        # 住所は「都道府県＋市区町村＋番地」と「建物名」を2行に
        addr1 = prefecture_ja(pick(d, "recipient_region")) + "".join(str(pick(d, k)) for k in ("recipient_locality", "recipient_street_address"))
        addr2 = str(pick(d, "recipient_extended_address"))
        addr = "\n".join(x for x in (addr1, addr2) if x) or pick(cobj, "address", "address_line_1")
        cust = customers.setdefault(name, {
            "name": name,
            "honorific": pick(d, "recipient_honorific") or "御中",
            "postal": pick(d, "recipient_postal_code") or pick(cobj, "postal_code", "zipcode"),
            "address": addr,
            "tel": pick(d, "recipient_phone_number") or pick(cobj, "phone", "tel", "phone_number"),
            "fax": pick(d, "recipient_fax_number") or pick(cobj, "fax", "fax_number"),
            "externalId": pick(cobj, "mid"),
        })

        lines = flatten_lines(resolve_lineitems(cli, d) or d.get("lines") or d.get("items") or [])
        if lines and not convert.sample:
            convert.sample = {k: type(v).__name__ for k, v in lines[0].items()}
        items = [it for it in (line_to_item(ln) for ln in lines) if it]
        if not items:
            # 内訳が取れなかった請求書は、原因調査のため明細の形を記録しておく
            convert.missing.append({
                "number": str(pick(d, "document_number")), "lines": len(lines),
                "kinds": sorted({str(ln.get("kind", "")) for ln in lines}),
                "fields": sorted(lines[0].keys()) if lines else [],
            })

        subtotal = money(pick(d, "subtotal", "total_excluding_tax", default=0))
        tax = money(pick(d, "tax", "tax_total", "total_tax", default=0))
        total = money(pick(d, "total", "total_including_tax", default=subtotal + tax))
        paid = is_paid(d)
        invoices.append({
            "externalId": pick(d, "mid") or pick(d, "url"),
            "source": "makeleaps",
            "number": str(pick(d, "document_number", "number")),
            "issueDate": date,
            "dueDate": to_date(pick(d, "date_due", "due_date", "payment_due_date")),
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
            "paidDate": paid_date(d) if paid else "",
            "paidAmount": total if paid else "",
            "memo": "MakeLeapsから取り込み",
        })
    return list(customers.values()), invoices, skipped


def export(cli, since=None, until=None, mid=None, log=print):
    """MakeLeaps から請求書を取得し、取り込み用データ（dict）と診断情報を返す"""
    log("認証中…")
    cli.auth()
    mid = mid or find_partner_mid(cli)
    log("取引先を取得中…")
    clients = cli.get_all(f"/api/partner/{mid}/client/")
    clients_by_url = {c.get("url"): c for c in clients if isinstance(c, dict)}
    log("書類を取得中…")
    docs = cli.get_all(f"/api/partner/{mid}/document/")
    log("明細を取得中…")
    convert.sample = None
    convert.missing = []
    resolve_lineitems.diag = None
    customers, invoices, skipped = convert(cli, docs, clients_by_url, since, until)
    out = {
        "app": "lucent-invoice", "kind": "makeleaps-import",
        "exportedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "range": {"since": since, "until": until},
        "customers": customers, "invoices": invoices,
    }
    diag = {
        "documents": len(docs), "invoices": len(invoices), "skipped": skipped,
        "paid": sum(1 for i in invoices if i["status"] == "paid"),
        "withItems": sum(1 for i in invoices if i["items"]),
        "itemFields": convert.sample, "lineitems": resolve_lineitems.diag,
        "missingItems": convert.missing,
    }
    return out, diag, {"clients": clients, "documents": docs}


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

    try:
        out, diag, raw = export(Client(cid, secret), since, a.until, a.mid)
    except MLError as e:
        sys.exit(str(e))

    if a.raw:
        with open("makeleaps-raw.json", "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False, indent=2)
        print("生データを makeleaps-raw.json に保存しました（顧客情報を含むので取り扱い注意）")
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    invoices = out["invoices"]
    total = sum(i["importedTotals"]["total"] for i in invoices)
    unpaid = sum(i["importedTotals"]["total"] for i in invoices if i["status"] != "paid")
    print("\n===== 書き出し完了 =====")
    print(f"期間        : {since or '全期間'} 〜 {a.until or '今日'}")
    print(f"請求書      : {len(invoices)} 件（取消など除外 {diag['skipped']} 件）")
    print(f"売上合計    : ¥{total:,}")
    print(f"うち未入金  : ¥{unpaid:,}")
    print(f"入金日あり  : {diag['paid']} 件")
    print(f"明細あり    : {diag['withItems']} / {len(invoices)} 件")
    print(f"明細の診断  : {diag['lineitems']}  項目: {diag['itemFields']}")
    for m in diag["missingItems"]:
        print(f"  内訳なし No.{m['number']}：明細{m['lines']}行 種類{m['kinds']} 項目{m['fields']}")
    print(f"取引先      : {len(out['customers'])} 社")
    print(f"ファイル    : {os.path.abspath(a.out)}")
    print("→ 請求書管理の「設定 → MakeLeapsから取り込む」で読み込んでください。")


if __name__ == "__main__":
    main()
