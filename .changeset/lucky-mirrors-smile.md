---
"@leconome/cli": patch
---

Fix `--save-key`: the key was written to `publish.json` but read back from
`config.json`, so a saved key was silently ignored and every run still demanded
`ECONOME_API_KEY`.

Credentials now live in their own 0600 file, deliberately not in the follower
config, which `join` rewrites wholesale and would clobber.
