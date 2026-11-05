# Go toolchain security remediation — November 5, 2026

GitHub Actions run [42046596486](https://github.com/harmohanjeetkaur/deployForge/actions/runs/42046596486)
for source commit `8a57b567231bb4b4684d9592d9058ebcc73fcb67` failed its blocking
security scan on both Linux architectures. The downloaded reports were bound to
that run/attempt and their ZIP archive digests were verified against GitHub metadata.

## Exact findings

Both reports identify the same four HIGH vulnerabilities in the compiled Go
standard library, version `v1.25.14`, inside `app/deployforge`:

| Vulnerability | Component and issue | Fixed Go versions reported by CI |
| --- | --- | --- |
| [CVE-2026-111943 / GO-2026-6809](https://pkg.go.dev/vuln/GO-2026-6809) | crypto/x509: trust in compromised intermediate certificates | 1.26.10, 1.27.3 |
| [CVE-2026-78667 / GO-2026-6609](https://pkg.go.dev/vuln/GO-2026-6609) | net/http: excessive CPU consumption from crafted Range headers | 1.26.9, 1.27.2 |
| [CVE-2026-78669 / GO-2026-6611](https://pkg.go.dev/vuln/GO-2026-6611) | HTTP/2: excessive CPU consumption from SETTINGS frames | 1.26.9, 1.27.2 |
| [CVE-2026-97031 / GO-2026-6607](https://pkg.go.dev/vuln/GO-2026-6607) | crypto/tls: memory exhaustion from repeated ECH outer extension references | 1.26.9, 1.27.2 |

The HIGH/CRITICAL-filtered Alpine 3.22.7 results contain no OS package findings.
The reported fixes are standard-library updates, not changes to the application's
Prometheus dependencies. We do not suppress findings based on reachability.

## Targeted fix

- `app/Dockerfile` replaces the Go 1.25 builder with Go **1.26.10**, a patched
  supported release on the next minor line. It pins the verified multi-platform
  image index to
  `sha256:a2012b4a1d1f9f7e9f44e0d39b805a901e856b1dd80b4e6ee4338db547050308`.
  Docker Hub metadata confirms Linux amd64 and arm64 variants. The runtime remains
  `alpine:3.22`, and the non-root user and static build are preserved.
- `app/go.mod` raises the Go requirement from 1.24.3 to **1.26.10**. The existing
  `actions/setup-go` step reads this file, so CI tests and container builds use the
  same patched release. Local Go installations can automatically download the
  required toolchain when toolchain selection is enabled. No globally installed
  Go toolchain was replaced during this fix.
- The README reflects the new Go requirement. Application code, module versions
  and `go.sum` are unchanged.

Go's [release history](https://go.dev/doc/devel/release#go1.26.10) confirms the
security patch. `golang:1.26.10-alpine3.22` is not a published tag; the verified
`1.26.10-alpine` builder is pinned by index digest instead. The builder's Alpine
version does not change the separate runtime base of the statically linked binary.

## Policy preservation

`.github/workflows/ci.yaml` is unchanged. Trivy still scans both architectures,
blocks HIGH/CRITICAL findings with exit code 1, includes unfixed vulnerabilities,
and uses no repository ignore-file exemptions. Tag-only publishing and the removal
of automatic CI Helm writes remain intact. No CI rerun, tag, image publication,
deployment or rollback was triggered for this local remediation.

## Verification performed

- Go 1.26.10 race/coverage tests and vet passed; all module checksums verified.
  API coverage: 86.4%; metrics coverage: 88.1%.
- Cross-built `CGO_ENABLED=0` Linux amd64 and arm64 binaries. Build metadata and
  Trivy's package inventory independently identify Go `v1.26.10` in both.
- Trivy **0.70.0**, matching the CI action's default scanner version, was downloaded
  to temporary storage and verified against its official release asset digest.
  Its fresh vulnerability database was updated at `2026-11-05T13:09:41Z`.
- Blocking scans of each rebuilt Linux binary found **zero HIGH/CRITICAL**
  vulnerabilities. Each was recognized as a Go binary with 12 inventoried packages;
  this was not an empty-directory scan.
- Remote-only image scans of `alpine:3.22` found **zero HIGH/CRITICAL** vulnerabilities
  on each architecture. Both identify Alpine 3.22.7 and 16 OS packages.
- Backend: 139 tests passed. Browser: 71 passed, four live opt-ins skipped.
- Frontend lint/build and both Helm chart lints passed.

The binary scan command, for each architecture, used the same severity, unfixed
and exit-code settings as CI:

```sh
trivy rootfs --config /dev/null --ignorefile /dev/null \
  --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed=false --exit-code 1 \
  --format json --output patched-linux-amd64.json /path/to/linux-amd64-binary-directory
```

Runtime base scans used `trivy image --image-src remote --platform linux/amd64`
(and linux/arm64), without accessing a container daemon. Both used the same
blocking policy. After one fresh database download, all scans shared that database
for a consistent comparison. Scanner caches, SDKs, binaries and raw JSON reports
remain outside the repository under `/private/tmp/deployforge-security-42046596486`.

These are real local component scans, **not a successful full container CI run**.
Docker and Kubernetes stayed stopped. An approved source commit/push must still
run the unchanged CI image-build-and-scan matrix before claiming pipeline success.
Re-running the old commit would rebuild the old vulnerable Dockerfile.
