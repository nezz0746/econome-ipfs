# @leconome/cli

One command to join the Econome IPFS cluster as a follower.

```bash
npx -y @leconome/cli join <join-url-from-dashboard>
```

Requires Docker. Manage the follower with:

```bash
econome status   # is it running / replicating, pin count
econome logs -f  # tail follower logs
econome stop     # stop (keeps data)
econome update   # pull newer images and restart
```

The join URL comes from the dashboard's **Onboarding** page (one per minted
token). The CLI fetches the cluster config, starts a Kubo + ipfs-cluster
follower under `~/.econome`, and registers the new peer with the dashboard.
