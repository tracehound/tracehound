# Crypto & Integrity Review

Security buffer → forensic integrity is critical.

Produce evidence:

- RNG only via crypto.randomBytes
- No SHA1 / MD5
- Constant-time comparison
- Canonical serialization
- No hash truncation
- Key rotation model
