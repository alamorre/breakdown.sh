# Support reference

Document kind: Generated reference

Document version: 1.0.0

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/conformance/hosts/fixtures/guided-journey.json` — SHA-256 `c445b63835d23be59e5e1dbb7f9b164e019d64fd167c75cb2e6419b5d273c6d7`
- `local/contracts/conformance/hosts/fixtures/human-rubric.json` — SHA-256 `d2618c7e5135adc1e80b6d91244d9acb67c94db57e7caebd2567bdd203b4b07b`
- `local/contracts/conformance/traceability/host.json` — SHA-256 `8b9792f692bd65bb8037af0700e21133166affa6b200f3ba1c0eb6e249e047cf`
- `local/contracts/schemas/breakdown.host-support-index.v1.schema.json` — SHA-256 `15bbdcf8c55ba621798ba02c7d20eb6e58a82607f558f0a648bd4e08d2ab6bd7`
- `local/contracts/specifications/skills-and-hosts.md` — SHA-256 `2c7b0f7c19d63656fbb331eda6c42088dfb3ba47e6fb3cb192a7f712f22dac93`
- `local/docs/release-metadata.json` — SHA-256 `41dadb3b249de0b06de694ae42293f417c0be04ded75903c05c4e9f7fc1a3b81`
- `local/skills/setup-breakdown/assets/skill-pack-manifest.json` — SHA-256 `9f510621ba946221e8e304cb2a66386822fe11096d204a5aecd5e8aadb673e00`


## Supported Host rows

| Exact row | Immutable policy or evidence |
| --- | --- |
| None | Certification is deliberately deferred to issue #188. |

## Supported Host certification is deferred

`supported_hosts: []`

Breakdown Local 1.0 deliberately carries no named Supported Host claim. The authenticated empty
support index records policy state `deferred`; it is not a
passing real-host qualification. Certification work continues in issue
#188.

An Agent Host with the required capabilities but no exact passing row is Compatible, not Supported.
A bare model or unprovisioned cloud surface is Unsupported. Support claims attach to an exact host
surface, host version, operating system, transport, Breakdown version, artifact digest, and passing
indexed evidence. Model/provider families do not become durable compatibility claims.

Evidence rule: No Supported Host claim without a passing indexed immutable evidence row.

`.github/workflows/local-host-evidence-capture.yml` (workflow ID
`324133712`) must remain
`disabled_manually` and must not be
dispatched for 1.0. It may be re-enabled only after issue #188 is implemented and accepted.
