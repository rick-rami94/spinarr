# Releasing

Installers are built by GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)), never on a laptop. Each OS builds its own engine from the pinned, checksum-verified sources, then packages the app with electron-builder.

| Runner | Output |
|---|---|
| `macos-15` | `Spinarr-<v>-mac-arm64.dmg` |
| `macos-15-intel` | `Spinarr-<v>-mac-x64.dmg` |
| `ubuntu-22.04` | `Spinarr-<v>-linux-x86_64.AppImage`, `Spinarr-<v>-linux-amd64.deb` |
| `ubuntu-22.04-arm` | `Spinarr-<v>-linux-arm64.AppImage`, `Spinarr-<v>-linux-arm64.deb` |
| `windows-2025` | `Spinarr-<v>-win-x64.exe` (per-user NSIS installer) |
| release job (`ubuntu-24.04`) | `SHA256SUMS.txt`, `SHA256SUMS.txt.sigstore.json` (cosign bundle), `spinarr-<v>.cdx.json` (CycloneDX SBOM), `spinarr-<v>-source.tar.gz` (complete corresponding source) |

The Linux builds run on Ubuntu 22.04 so they work on any distribution with glibc 2.35 or newer.

## Cut a release

A published release can't be changed. Immutable Releases is on for this repository, so once a release is published its tag and files are locked. If you delete it, the tag name is gone for good: you can never reuse it. **Never publish before the draft passes verification.**

1. **Rehearse.** From the milestone branch, push an unsigned rehearsal tag: `git tag v0.2.0-rc.1 && git push origin v0.2.0-rc.1`. The `v*` trigger matches it. The workflow builds everything and creates a draft. Check it, then delete the draft and the rc tag. Rehearsal drafts are throwaway and are never published.
2. **Bump the version.** Change `version` in `package.json` through a pull request to `main`. The tag version must equal the `package.json` version, ignoring any `-rc.N` suffix. The workflow fails if they differ.
3. **Tag `main`.** `git tag v0.2.0 && git push origin v0.2.0`.
4. **CI builds a draft.** It builds all five targets, signs and notarizes where the secrets exist, then creates a **draft** release with the installers, `SHA256SUMS.txt`, its cosign bundle, the SBOM, the source tarball and generated notes. If any platform came out unsigned (because its signing secrets aren't set yet), the draft is marked **pre-release** and the notes say which platforms are unsigned. If the secrets exist and a build still comes out unsigned, the build fails instead.
5. **Verify the draft.** Download the files from the draft and run the checks in [Verifying a release](#verifying-a-release). Install on a Mac and on Windows.
6. **Publish by hand.** Only now, click **Publish release**.

To get the installers without making a release, run the workflow manually (**Actions → Release → Run workflow**) and download the artifacts.

## Signing accounts (one-time)

Both accounts are set up by hand, once. The pipeline works without them: unsigned builds still succeed and are marked pre-release. Start the Azure section early. Identity validation can take several days.

Every signature names the individual **Rick Ramirez**. There's no business entity and no D-U-N-S number.

### Apple: Developer ID certificate and notarization key

You need an active Apple Developer Program membership.

**Developer ID Application certificate**

1. On your Mac, open **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**. Enter your email and the name `Rick Ramirez`, choose **Saved to disk**, and save the `.certSigningRequest` file.
2. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list) and click **+**.
3. Choose **Developer ID Application**. When asked, pick the **G2 Sub-CA** (Xcode 11.4.1 or later). Upload the CSR and download the `.cer`.
4. Double-click the `.cer` to install it in your login keychain.
5. Confirm it's there: `security find-identity -v -p codesigning`. You should see `Developer ID Application: Rick Ramirez (<TEAMID>)`.
6. In Keychain Access, find that certificate under **My Certificates**, expand it so the private key shows, select both, and choose **Export 2 items…**. Save as `cert.p12` with a strong password.
7. Base64 it to the clipboard: `base64 -i cert.p12 | pbcopy`. That's `MAC_CERT_P12_BASE64`. The password is `MAC_CERT_PASSWORD`. Then delete `cert.p12` from disk.

**App Store Connect API key (for notarization)**

It must be a **Team key**. Individual keys fail with `notarytool`.

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access → Integrations → App Store Connect API → Team Keys**. (Only the Account Holder can request access the first time.)
2. Click **+**, name it `spinarr-notary`, choose the **Developer** role, and generate it.
3. Download `AuthKey_<KEYID>.p8`. Apple lets you download it **once**. Store it somewhere safe.
4. Note the **Key ID** (in the table) and the **Issuer ID** (above the table).
5. Confirm it works: `xcrun notarytool history --key AuthKey_<KEYID>.p8 --key-id <KEYID> --issuer <ISSUER_ID>`. An empty history with no error means the key is good.
6. Base64 it: `base64 -i AuthKey_<KEYID>.p8 | pbcopy`. That's `APPLE_API_KEY_P8_BASE64`.

**Apple secrets** (environment `release`)

| Name | Kind | Value comes from |
|---|---|---|
| `MAC_CERT_P12_BASE64` | secret | Step 7 above: base64 of the exported `.p12` |
| `MAC_CERT_PASSWORD` | secret | The password you set on the `.p12` |
| `APPLE_API_KEY_P8_BASE64` | secret | Base64 of `AuthKey_<KEYID>.p8` |
| `APPLE_API_KEY_ID` | secret | The Key ID |
| `APPLE_API_ISSUER` | secret | The Issuer ID |

Add each with `gh secret set <NAME> --env release` (it prompts for the value, so nothing lands in your shell history). Confirm with `gh secret list --env release`: all five names should be listed.

### Azure: Artifact Signing for Windows

Individuals in the USA and Canada can use Azure Artifact Signing (formerly Trusted Signing). The Basic plan costs about $9.99 a month.

1. **Subscription.** Create an Azure account at [portal.azure.com](https://portal.azure.com) with a pay-as-you-go subscription. The billing account type must be **Individual**, and its legal name and address must match your government ID exactly. Validation checks them.
2. **Resource provider.** In the portal: **Subscriptions → (your subscription) → Settings → Resource providers**, search for `Microsoft.CodeSigning` and click **Register**. Or: `az provider register --namespace Microsoft.CodeSigning`.
3. **Signing account.** Search the portal for **Artifact Signing Accounts → Create**. Pick a resource group (for example `spinarr-signing`), a name (for example `spinarr`), a region, and the **Basic** plan. After it deploys, open it and note the **Account URI** on the Overview page, for example `https://eus.codesigning.azure.net/`. That's `AZURE_SIGNING_ENDPOINT`; the account name is `AZURE_SIGNING_ACCOUNT`.
4. **Identity Verifier role.** On the signing account: **Access control (IAM) → Add role assignment → Artifact Signing Identity Verifier**, and assign it to yourself. Without it, the next step is greyed out.
5. **Identity validation.** On the signing account: **Objects → Identity validations → New identity → Public → Individual**. Enter your legal name `Rick Ramirez` and address exactly as on your ID. The flow sends you through an identity check (photo ID and a selfie, then a Verified ID in Microsoft Authenticator). Wait until its status is **Completed**. This can take days.
6. **Certificate profile.** On the signing account: **Objects → Certificate profiles → Create → Public Trust**. Name it (for example `spinarr-public`) and select the completed identity validation. The profile name is `AZURE_CERT_PROFILE`.
7. **Entra app registration.** In **Microsoft Entra ID → App registrations → New registration**, name it `spinarr-release-signing`, single tenant, no redirect URI. Note the **Application (client) ID** (`AZURE_CLIENT_ID`) and **Directory (tenant) ID** (`AZURE_TENANT_ID`). Don't create a client secret.
8. **Federated credential.** On that app: **Certificates & secrets → Federated credentials → Add credential → Other issuer** (or the GitHub Actions scenario with entity type **Environment**). Use exactly:

   | Field | Value |
   |---|---|
   | Issuer | `https://token.actions.githubusercontent.com` |
   | Subject | `repo:rick-rami94/spinarr:environment:release` |
   | Audience | `api://AzureADTokenExchange` |

   The subject is the `release` environment, not a tag. Entra doesn't support wildcards, so a tag subject would work for one tag only.
9. **Signer role.** Open the certificate profile from step 6: **Access control (IAM) → Add role assignment → Artifact Signing Certificate Profile Signer**, and assign it to the `spinarr-release-signing` app. Scope it to the profile only.
10. **Subscription ID.** From **Subscriptions**, copy the subscription ID (`AZURE_SUBSCRIPTION_ID`).

**Azure secrets and variables** (environment `release`)

| Name | Kind | Value comes from |
|---|---|---|
| `AZURE_CLIENT_ID` | secret | Step 7: Application (client) ID |
| `AZURE_TENANT_ID` | secret | Step 7: Directory (tenant) ID |
| `AZURE_SUBSCRIPTION_ID` | secret | Step 10 |
| `AZURE_SIGNING_ENDPOINT` | variable | Step 3: Account URI, for example `https://eus.codesigning.azure.net/` |
| `AZURE_SIGNING_ACCOUNT` | variable | Step 3: signing account name |
| `AZURE_CERT_PROFILE` | variable | Step 6: certificate profile name |

Add secrets with `gh secret set <NAME> --env release` and variables with `gh variable set <NAME> --env release --body <value>`. Confirm with `gh secret list --env release` (three Azure names plus the five Apple ones) and `gh variable list --env release` (three names).

### Retired secrets

These are no longer read anywhere. Delete them if they exist at repository level: `APPLE_ID`, `APPLE_TEAM_ID`, the old Apple app-specific password secret, and the old Windows `.pfx` certificate and password secrets. Notarization uses the API key above, and Windows signing uses Azure.

## GitHub settings

- **Environment `release`.** Settings → Environments → `release`, with **Deployment branches and tags → Selected branches and tags** and a single **tag** rule `v*`. Only `v*` tag runs can use it, so pull request and branch runs never see the signing credentials. It must exist, with that rule, before any workflow references it. Otherwise GitHub creates it on first use with no protection.
- **Environment `fuzz`.** Holds the fuzzing credentials (see below). It's created in plan 02-04.
- **Immutable Releases.** Settings → General → Releases → **Enable release immutability**. Assets and tags lock at publish time, and GitHub generates a release attestation.
- **Signing secrets live only in the `release` environment, never at repository level.** `gh secret list` (no `--env`) should show none of the names above.

## Fuzz credentials

The nightly fuzz job needs to write crash reproducers to the private corpus repo `rick-rami94/spinarr-fuzz-corpus` and open private draft advisories on `rick-rami94/spinarr`. Pick one option (the choice is made in plan 02-04). Both live in the `fuzz` environment.

| Option | Names | Permissions |
|---|---|---|
| GitHub App (preferred) | variable `FUZZ_APP_ID`, secret `FUZZ_APP_PRIVATE_KEY` | Installed on both repos. **Contents: read and write** on `spinarr-fuzz-corpus`; **Repository security advisories: read and write** on `spinarr`. Nothing else. |
| Two fine-grained PATs | secrets `FUZZ_CORPUS_TOKEN`, `FUZZ_ADVISORY_TOKEN` | `FUZZ_CORPUS_TOKEN`: only `spinarr-fuzz-corpus`, Contents read and write. `FUZZ_ADVISORY_TOKEN`: only `spinarr`, Repository security advisories read and write. Set an expiry and a reminder to rotate. |

Confirm with `gh secret list --env fuzz` and `gh variable list --env fuzz`.

## Verifying a release

Every release ships `SHA256SUMS.txt`, a Sigstore bundle that signs it, and GitHub attestations for each file. Replace `vX.Y.Z` and the file names with the release you downloaded.

**1. Checksums.** In the folder with the files and `SHA256SUMS.txt`:

```sh
sha256sum -c --ignore-missing SHA256SUMS.txt        # Linux, Windows (Git Bash / WSL)
shasum -a 256 -c --ignore-missing SHA256SUMS.txt    # macOS
```

**2. The checksum file was signed by this repository's release workflow** (needs [cosign](https://docs.sigstore.dev/cosign/system_config/installation/)):

```sh
cosign verify-blob --bundle SHA256SUMS.txt.sigstore.json \
  --certificate-identity https://github.com/rick-rami94/spinarr/.github/workflows/release.yml@refs/tags/vX.Y.Z \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS.txt
```

It must print `Verified OK`. A different identity means the file wasn't built by Spinarr's release workflow for that tag.

**3. Build provenance** (needs the [GitHub CLI](https://cli.github.com)):

```sh
gh attestation verify Spinarr-X.Y.Z-mac-arm64.dmg --repo rick-rami94/spinarr
gh attestation verify spinarr-X.Y.Z.cdx.json --repo rick-rami94/spinarr --predicate-type https://cyclonedx.org/bom
```

The second command checks the SBOM attestation.

**4. The published release hasn't changed** (after publish only):

```sh
gh release verify vX.Y.Z --repo rick-rami94/spinarr
gh release verify-asset vX.Y.Z Spinarr-X.Y.Z-mac-arm64.dmg --repo rick-rami94/spinarr
```

**5. The OS check.** On macOS, `spctl -a -t open -vvv --context context:primary-signature Spinarr-X.Y.Z-mac-arm64.dmg` should say `source=Notarized Developer ID`. On Windows, in PowerShell, `Get-AuthenticodeSignature .\Spinarr-X.Y.Z-win-x64.exe` should show `Valid` with signer `CN=Rick Ramirez`.

Releases v0.1.x were not signed and have none of this. Use v0.2.0 or later.

## What gets checked on a signed tag build

When the signing secrets are set, the build fails unless these pass.

- **macOS, [`build/verify-mac.sh`](../build/verify-mac.sh):**
  - `codesign --verify --deep --strict` on the app, signed by `Developer ID Application: Rick Ramirez`, with the hardened runtime and a secure timestamp.
  - Every engine binary has `disable-library-validation` and not `allow-jit`. The app has `allow-jit` and not `disable-library-validation`.
  - `xcrun stapler validate` on the app and the dmg.
  - `spctl -a -t exec -vvv` on the app, and `spctl -a -t open -vvv --context context:primary-signature` on the dmg. Both must report `source=Notarized Developer ID`. (This corrects the literal `spctl -t install` in decision D-04: `-t install` is for installer packages, and it misreports a notarized dmg.)
- **Windows, [`build/verify-win.ps1`](../build/verify-win.ps1):** the installer, the app exe and every exe under `resources/engine` must have `Get-AuthenticodeSignature` status `Valid`, signer `CN=Rick Ramirez`, a timestamp, and pass `signtool verify /pa /all`.

## What's in every build

- Electron fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, the app only loads from its integrity-checked `app.asar`, and cookies are encrypted.
- The engine (`ffmpeg`, `ffprobe`, `dvdinfo`, `bdinfo`) in `resources/engine`, statically linked apart from OS libraries. The build script fails loudly if anything else is linked.
- **No** libdvdcss, libaacs, libbdplus or keys.
- Signed macOS builds use the hardened runtime with three entitlement files. The app and its helpers get only `allow-jit`, for V8 ([`build/entitlements.mac.plist`](../build/entitlements.mac.plist), [`build/entitlements.mac.inherit.plist`](../build/entitlements.mac.inherit.plist)). The engine binaries get only `disable-library-validation`, so they can load the user's own Homebrew libdvdcss, which we don't sign ([`build/entitlements.engine.plist`](../build/entitlements.engine.plist)).

## Fuzz crash handling

Spinarr fuzzes its disc parsers (IFO, MPLS/CLPI, VOB/NAV) on every engine change and nightly. A crash is a possible vulnerability, so it's handled privately:

1. **Private advisory.** The nightly job opens a **private draft GitHub Security Advisory** on this repository with the stack trace. Only the maintainer can see it. Crashing inputs are never uploaded as public CI artifacts or issues.
2. **Private reproducers.** The corpus and crash reproducers live in the private repo `rick-rami94/spinarr-fuzz-corpus`.
3. **Pull requests.** A PR run that finds a new crash fails the check with a message that points to the private advisory. It doesn't show the input.
4. **Fix.** The fix ships as a numbered patch in [`engine/patches/`](../engine/patches/), like the earlier fuzz fixes.
5. **Upstream.** The bug is reported privately to the upstream VideoLAN project (libdvdread, libdvdnav or libbluray). Once a Spinarr release ships the fix, the patch is sent upstream.
6. **Regression case.** After the fix ships, the minimized reproducer moves into the public malicious-disc corpus under `test/fixtures/malicious/`, so it runs on every change from then on.
