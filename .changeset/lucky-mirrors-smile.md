---
"@leconome/cli": patch
---

Replace `publish --save-key` with a dedicated `econome auth` command.

Storing a credential was a flag on `publish`, so it required a directory
argument that you do not have yet when signing in: `econome publish --save-key`
failed with "missing required argument 'dir'".

`econome auth login` prompts for the key, verifies it against the API before
storing it, and writes it to `~/.econome/creds.json` at 0600. `auth status`
reports where the key comes from without printing it, and warns when an
environment variable is shadowing a stored key. `auth logout` removes it.

Also fixes the underlying bug: the key was written to one file and read back
from another, so a saved key was silently ignored.
