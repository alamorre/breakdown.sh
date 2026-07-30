# Maintain Linux and macOS for Breakdown Local 1.0

Breakdown Local 1.0 maintains Linux glibc x64/arm64 and macOS x64/arm64. Windows is Unsupported because Node 24 cannot establish or verify the current-user-only ACL and native-filesystem guarantees required by the secure store without either spawning platform tools or shipping native code, both of which remain outside the 1.0 package and security boundaries.

## Consequences

- The Windows secure-store guard remains fail-closed and Windows receives no platform or Supported Host claim for 1.0.
- Stable platform qualification requires the four maintained Linux and macOS tuples, and guided-host qualification requires Linux and macOS CLI rows across at least two model or provider families.
- Future Windows support requires a separate architecture decision covering a signed native adapter or a deliberately revised security and packaging boundary.
