# Support reference

Document kind: Generated reference

Document version: 1.0.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/conformance/hosts/fixtures/guided-journey.json` — SHA-256 `d98f630de5855b0dc90daa18367e2fc0f2cad7ea7592a1f523de532b49c8eb68`
- `local/contracts/conformance/hosts/fixtures/human-rubric.json` — SHA-256 `8c987f7773d82281467be07a83efcbea309f53e24d5680c5a620c3224b9bdcfd`
- `local/contracts/conformance/traceability/host.json` — SHA-256 `e6b87625e506e8286e8f02adf7c24839e13ad0c317160af452dc6cbfdb1d774b`
- `local/contracts/schemas/breakdown.host-support-index.v1.schema.json` — SHA-256 `c429efb7f2954a13bf2a244ccef7cc465cf08fb41dc8c9dbc3f000e127a37ee4`
- `local/contracts/specifications/skills-and-hosts.md` — SHA-256 `98667061588f303b0b45a8c5fe7d20ddbb5c4fca11622888e17c6dcc7ab7afce`
- `local/docs/release-metadata.json` — SHA-256 `f425ce5a60cdfb6418c950f2ecc007838af04b3383bc41229d84befd62dced99`
- `local/skills/setup-breakdown/assets/skill-pack-manifest.json` — SHA-256 `6abf985616148d4d3e2627857be6d79d20e0297413d305286f88cd99fbbfb46c`


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
