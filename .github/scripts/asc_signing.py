"""Temporary signing for a TestFlight upload, using the App Store Connect API key.

  python3 asc_signing.py create <bundle id> <work dir>
      Makes a fresh private key, asks Apple for an Apple Distribution
      certificate and an App Store provisioning profile, and writes:
        <work dir>/signing.p12   (certificate + key, password-protected)
        <work dir>/profile.mobileprovision
      Values the workflow needs are appended to $GITHUB_ENV.

  python3 asc_signing.py cleanup
      Revokes that certificate and deletes the profile. Builds already uploaded
      to App Store Connect / TestFlight are not affected by this.

Reads ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 from the environment.
"""
import base64
import os
import secrets
import sys
import time

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from asc_precheck import call  # same authenticated API helper


def env_out(**kv):
    with open(os.environ["GITHUB_ENV"], "a") as f:
        for k, v in kv.items():
            f.write(f"{k}={v}\n")


def create(bundle_id, work):
    os.makedirs(work, exist_ok=True)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([
               x509.NameAttribute(NameOID.COMMON_NAME, "GitHub Actions build"),
               x509.NameAttribute(NameOID.COUNTRY_NAME, "US")]))
           .sign(key, hashes.SHA256()))
    csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode()

    cert = call("POST", "/certificates", {"data": {"type": "certificates", "attributes": {
        "certificateType": "DISTRIBUTION", "csrContent": csr_pem}}})["data"]
    cert_id = cert["id"]
    env_out(SIGN_CERT_ID=cert_id)
    print("Created temporary Apple Distribution certificate.")

    der = base64.b64decode(cert["attributes"]["certificateContent"])
    certificate = x509.load_der_x509_certificate(der)
    password = secrets.token_hex(16)
    print(f"::add-mask::{password}")
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder()
           .kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC)
           .hmac_hash(hashes.SHA1())
           .build(password.encode()))
    p12 = pkcs12.serialize_key_and_certificates(
        b"GitHub Actions build", key, certificate, None, enc)
    with open(os.path.join(work, "signing.p12"), "wb") as f:
        f.write(p12)

    bid = [b for b in call("GET", f"/bundleIds?filter[identifier]={bundle_id}&limit=200")["data"]
           if b["attributes"]["identifier"] == bundle_id][0]["id"]
    name = f"GitHub TestFlight {bundle_id} {int(time.time())}"
    prof = call("POST", "/profiles", {"data": {
        "type": "profiles",
        "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
        "relationships": {
            "bundleId": {"data": {"type": "bundleIds", "id": bid}},
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]}}}})["data"]
    env_out(SIGN_PROFILE_ID=prof["id"], SIGN_PROFILE_NAME=name,
            SIGN_PROFILE_UUID=prof["attributes"]["uuid"], SIGN_P12_PASSWORD=password)
    with open(os.path.join(work, "profile.mobileprovision"), "wb") as f:
        f.write(base64.b64decode(prof["attributes"]["profileContent"]))
    print("Created temporary App Store provisioning profile.")


def cleanup():
    pid = os.environ.get("SIGN_PROFILE_ID")
    cid = os.environ.get("SIGN_CERT_ID")
    if pid:
        call("DELETE", f"/profiles/{pid}")
        print("Deleted temporary provisioning profile.")
    if cid:
        call("DELETE", f"/certificates/{cid}")
        print("Revoked temporary certificate.")


if __name__ == "__main__":
    if sys.argv[1] == "create":
        create(sys.argv[2], sys.argv[3])
    else:
        cleanup()
