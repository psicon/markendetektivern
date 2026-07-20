#!/usr/bin/env python3
"""Play Developer Reporting API helper.

Usage:
  play_api.py post <metricSetOrMethod> '<json-body>'   # POST z.B. crashRateMetricSet:query
  play_api.py get  '<path-with-query>'                 # GET  z.B. 'errorIssues:search?filter=...'
Token wird 50 min in /tmp gecacht, damit parallele Aufrufe ihn teilen.
"""
import json, urllib.request, urllib.parse, ssl, sys, time, base64, os

SA_PATH = "/Users/patricksieber/Documents/src/markendetektivern/markendetektive-895f7-ee3923910ddd.json"
APP = "de.markendetektive"
BASE = f"https://playdeveloperreporting.googleapis.com/v1beta1/apps/{APP}/"
TOKEN_CACHE = "/tmp/play_reporting_token.json"

SSL = ssl.create_default_context(); SSL.check_hostname = False; SSL.verify_mode = ssl.CERT_NONE

def get_token():
    try:
        c = json.load(open(TOKEN_CACHE))
        if c["exp"] - time.time() > 120:
            return c["token"]
    except Exception:
        pass
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    sa = json.load(open(SA_PATH))
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=")
    now = int(time.time())
    hdr = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claim = b64(json.dumps({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/playdeveloperreporting",
        "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3600,
    }).encode())
    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = b64(key.sign(hdr + b"." + claim, padding.PKCS1v15(), hashes.SHA256()))
    tok = json.loads(urllib.request.urlopen(urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": (hdr + b"." + claim + b"." + sig).decode(),
        }).encode()), timeout=30, context=SSL).read())["access_token"]
    try:
        json.dump({"token": tok, "exp": now + 3000}, open(TOKEN_CACHE, "w"))
    except Exception:
        pass
    return tok

def call(method, path, body=None):
    tok = get_token()
    H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    url = BASE + path
    last = None
    for i in range(6):
        try:
            r = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None),
                                       headers=H, method=method)
            return json.loads(urllib.request.urlopen(r, timeout=60, context=SSL).read())
        except urllib.error.HTTPError as e:
            txt = e.read().decode()[:400]
            last = {"_error": e.code, "_body": txt}
            if e.code in (500, 503, 429) and i < 5:
                time.sleep(3 + 3 * i); continue
            return last
        except Exception as e:
            last = {"_error": "exc", "_body": str(e)[:300]}
            time.sleep(2 + 2 * i)
    return last

if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "post":
        out = call("POST", sys.argv[2], json.loads(sys.argv[3]))
    else:
        out = call("GET", sys.argv[2])
    print(json.dumps(out, ensure_ascii=False, indent=1))
