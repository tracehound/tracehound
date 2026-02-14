# Isolation & Containment Proof

The quarantine claim must be technically validated.

Produce evidence:

- FS access policy
- Is network disabled?
- Is temp storage predictable?
- Is child execution sandboxed?
- Is there a privilege drop?
- seccomp / container profile

The Node attack surface reaches down to the system-call level; syscall whitelisting significantly reduces this.
