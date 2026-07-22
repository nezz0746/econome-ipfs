---
"@leconome/cli": minor
---

Replace `publish --save-key` with a dedicated `econome auth` command.

Storing a credential was a flag on `publish`, which requires a directory
argument, so `econome publish --save-key` failed with "missing required
argument 'dir'". You do not have a directory in mind when you are signing in.

`econome auth login` prompts for the key, verifies it against the API before
storing it, and writes `~/.econome/creds.json` at 0600. `auth status` reports
where the key comes from without printing it, and warns when `ECONOME_API_KEY`
is shadowing a stored key. `auth logout` removes it.

The credentials file is renamed from `publish.json` to `creds.json`, since
anything beyond publish that reaches the machine API will use the same
credential. `--save-key` is removed rather than deprecated: it never worked in
any published version.
