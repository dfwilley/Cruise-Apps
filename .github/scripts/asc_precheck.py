"""Pre-flight check before a TestFlight upload.

1. Makes sure the app's bundle ID is registered with Apple (registers it if not).
2. Makes sure an app record exists in App Store Connect for that bundle ID.
   Apple does not allow creating app records through its API, so if the record
   is missing this script stops with plain instructions.

Reads the App Store Connect API key from environment variables:
  ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8
Usage: python3 asc_precheck.py <bundle id> "<name for the bundle ID>"
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt  # PyJWT

API = "https://api.appstoreconnect.apple.com/v1"


def token():
    now = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 900,
         "aud": "appstoreconnect-v1"},
        os.environ["ASC_KEY_P8"],
        algorithm="ES256",
        headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"},
    )


def call(method, path, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": "Bearer " + token(),
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        sys.exit(f"::error::Apple API {method} {path} failed ({e.code}): {detail}")


def main():
    bundle_id, name = sys.argv[1], sys.argv[2]
    q = urllib.parse.quote(bundle_id)

    ids = call("GET", f"/bundleIds?filter[identifier]={q}&limit=200")["data"]
    match = [b for b in ids if b["attributes"]["identifier"] == bundle_id]
    if match:
        print(f"Bundle ID {bundle_id} is registered.")
        seed = match[0]["attributes"].get("seedId")
        team = os.environ.get("APPLE_TEAM_ID", "").strip()
        print("APPLE_TEAM_ID matches Apple's team ID:", seed == team,
              f"(secret is {len(team)} characters, Apple's is {len(seed or '')})")
    else:
        call("POST", "/bundleIds", {"data": {"type": "bundleIds", "attributes": {
            "identifier": bundle_id, "name": name, "platform": "IOS"}}})
        print(f"Registered bundle ID {bundle_id}.")

    apps = [a for a in call("GET", "/apps?limit=200")["data"]
            if a["attributes"]["bundleId"] == bundle_id]
    if not apps:
        seen = call("GET", "/apps?limit=200")["data"]
        print("Apps this key can see:", [
            (a["attributes"]["name"], a["attributes"]["bundleId"]) for a in seen] or "none")
        sys.exit(
            "::error::No app record in App Store Connect yet. One-time fix: "
            "appstoreconnect.apple.com > Apps > + > New App > Platform iOS, "
            f"Name '{name}', Bundle ID {bundle_id}, SKU any text "
            "(e.g. the bundle ID), User Access Full Access > Create. "
            "Then re-run this build.")
    print(f"App record found: {apps[0]['attributes']['name']}")


if __name__ == "__main__":
    main()
