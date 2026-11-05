"""Prepare ephemeral signing inputs; never print secrets or profile contents."""
import base64
import datetime
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys

BUNDLE = 'com.dfwilley.portguide'

def validate_profile(profile, team):
    entitlements = profile.get('Entitlements', {})
    if team not in profile.get('TeamIdentifier', []):
        raise ValueError('Provisioning profile team does not match APPLE_TEAM_ID')
    prefixes = profile.get('ApplicationIdentifierPrefix', [])
    if entitlements.get('application-identifier') not in [p + '.' + BUNDLE for p in prefixes]:
        raise ValueError('Profile must match the explicit Port Guide bundle ID')
    if profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices') or entitlements.get('get-task-allow'):
        raise ValueError('Use an App Store distribution profile, not development, ad hoc or enterprise')
    if profile['ExpirationDate'].replace(tzinfo=datetime.timezone.utc) <= datetime.datetime.now(datetime.timezone.utc):
        raise ValueError('Provisioning profile has expired')
    if not re.fullmatch(r'[A-Fa-f0-9-]{36}', profile.get('UUID', '')):
        raise ValueError('Invalid provisioning profile UUID')

def main():
    root = Path(os.environ['RUNNER_TEMP']) / 'port-guide-signing'
    if '--cleanup' in sys.argv:
        record = root / 'installed-paths.txt'
        if record.exists():
            for p in record.read_text().splitlines():
                Path(p).unlink(missing_ok=True)
        shutil.rmtree(root, ignore_errors=True)
        return
    root.mkdir(mode=0o700, exist_ok=True)
    for key in ('APPLE_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID'):
        if not re.fullmatch(r'[A-Za-z0-9-]+', os.environ[key]):
            raise ValueError(f'{key} contains invalid characters or whitespace')
    def write(name, content):
        p = root / name
        p.write_bytes(content)
        p.chmod(0o600)
        return p
    write('certificate.p12', base64.b64decode(os.environ['IOS_DISTRIBUTION_P12_BASE64']))
    p = write('profile.mobileprovision', base64.b64decode(os.environ['PORT_GUIDE_PROFILE_BASE64']))
    write('AuthKey_' + os.environ['ASC_KEY_ID'] + '.p8', os.environ['ASC_KEY_P8'].replace('\r', '').encode())
    profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(p)]))
    validate_profile(profile, os.environ['APPLE_TEAM_ID'])
    installed = []
    for folder in ('Library/MobileDevice/Provisioning Profiles', 'Library/Developer/Xcode/UserData/Provisioning Profiles'):
        dest = Path.home() / folder / (profile['UUID'] + '.mobileprovision')
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, dest)
        installed.append(str(dest))
    write('installed-paths.txt', '\n'.join(installed).encode())
    with open(os.environ['GITHUB_ENV'], 'a') as f:
        f.write('PROFILE_UUID=' + profile['UUID'] + '\n')
    options = dict(method='app-store-connect', destination='export', signingStyle='manual',
                   teamID=os.environ['APPLE_TEAM_ID'], signingCertificate='Apple Distribution',
                   provisioningProfiles={BUNDLE: profile['UUID']}, manageAppVersionAndBuildNumber=False,
                   uploadSymbols=True)
    write('ExportOptions.plist', plistlib.dumps(options))

if __name__ == '__main__':
    main()
