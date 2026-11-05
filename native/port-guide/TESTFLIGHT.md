# Port Pocket Guide: TestFlight setup

Bundle ID: `com.dfwilley.portguide`. Version: `1.0`. Minimum iOS: 16.
The existing Sideloadly workflow is unchanged. The new workflow runs only when manually started.

## Apple setup

1. Use an active Apple Developer Program membership. Register the explicit bundle ID above, then create an iOS app record in App Store Connect named Port Pocket Guide (or an available name), using that bundle ID and English as the primary language. Choose a unique internal SKU.
2. Obtain an Apple Distribution certificate with its private key, exported as a password-protected `.p12`. Create an App Store distribution provisioning profile for this bundle ID and certificate.
3. Create an App Store Connect API key with permission to upload builds to this app. Do not paste the private key, certificate or passwords into a chat or commit them.

## GitHub setup

In `dfwilley/Cruise-Apps`, create an environment named `testflight`. Recommended: require your approval before this environment can run, and restrict deployment branches to main.
Add these environment secrets using GitHub's settings:

| Secret | Value |
|---|---|
| APPLE_TEAM_ID | Apple Developer team ID |
| ASC_KEY_ID | App Store Connect API key ID |
| ASC_ISSUER_ID | API key issuer ID |
| ASC_KEY_P8 | Complete downloaded API private key text |
| IOS_DISTRIBUTION_P12_BASE64 | Base64 of the exported distribution certificate and private key |
| IOS_DISTRIBUTION_P12_PASSWORD | Password for that export |
| PORT_GUIDE_PROFILE_BASE64 | Base64 of this app's App Store provisioning profile |

Secrets in another repository are not automatically available here. Use the same Apple team and app record throughout.

## Build and distribute

After adding these configuration files to main, open Actions > Port Pocket Guide - TestFlight > Run workflow. Supply a new positive integer build number higher than previous uploads for version 1.0. Approve the environment if required.

The job tests the web logic and native iPhone simulator target, validates profile identity/expiry/distribution type, archives and exports using manual signing, uploads to Apple, and removes temporary signing material. It does not revoke your certificate, create a public release or invite testers.

After Apple processes the build, open the app's TestFlight tab. Resolve export-compliance questions accurately, provide beta information and contact details, then add the build to an internal test group. External testing may require Beta App Review before invitations are available. Review privacy declarations based on the app's actual location, web and third-party service behavior; no blanket privacy/compliance answers are supplied here.

## Validation and limitations

Prepared on Windows. Existing 22 JavaScript test groups pass. Signing helper compiles; profile-validation cases are tested separately. Native compilation, simulator execution, signing and Apple acceptance must be verified by the macOS workflow. No credentials or Apple account configuration were accessed. The device display name remains Port Guide to preserve the existing app configuration.

Apple references:
- https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app
- https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
- https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile
