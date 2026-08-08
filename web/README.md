# Static site for foreheadfrenzy.benlocher.com

Served from the dailyoffice box (same pattern as other `*.benlocher.com` sites).

## URLs

- https://foreheadfrenzy.benlocher.com/
- https://foreheadfrenzy.benlocher.com/privacy-policy.html

## One-time DNS + TLS

```bash
./scripts/setup-foreheadfrenzy-dns.sh
```

Points the `foreheadfrenzy` A record at `104.237.147.195` and runs certbot for this vhost only.

## Deploy after changing files here

Commit `web/`, then:

```bash
git push prod HEAD:main
```

Remote: `dailyoffice:/var/repo/foreheadfrenzy.benlocher.com.git`  
Hook publishes **only** this `web/` directory into `/var/www/foreheadfrenzy.benlocher.com`. Other sites are untouched.

