# Security model

## Authentication

Access tokens are short lived. Refresh tokens are random credentials stored only in HTTP-only cookies; only their SHA-256 hashes are persisted. Cookies use `Secure` in production and `SameSite=Strict`. Rotation revokes the previous session token. A reused token is treated as a security event and revokes the token family.

Passwords use Argon2id. Five consecutive failures lock the account temporarily. Login has an additional in-process IP rate limit; it is not Redis-backed or shared between API replicas. Verification and reset tokens are delivered to the caller only in development responses; production email delivery is not implemented.

## Authorization

Roles map to explicit permissions. `requirePermission()` runs after authentication on protected mutation and operational routes. Store-bound resources validate the actor's store assignment, including sale and receipt retrieval. The UI mirrors permissions for usability, but it is not a security boundary.

## Data handling

- Logs redact authorization, cookies, passwords, tokens, and secrets.
- Zod validates all input at the transport boundary.
- CORS is restricted to `WEB_ORIGIN`; Helmet supplies browser security headers.
- Audit entries capture material administrative changes, but never credential data.
- QR payloads contain a public product reference and signed version, not MongoDB IDs or pricing.

## Production checklist

- Replace all example secrets with values from a secret manager.
- Terminate TLS at the ingress and set secure cookie mode.
- Use a managed MongoDB replica set with encryption and point-in-time recovery.
- Configure Redis authentication/TLS and separate rate-limit/cache namespaces.
- Add email delivery, malware scanning for uploads, and an external security event sink.
- Run SAST, dependency, container, and DAST scans in CI before deployment.
