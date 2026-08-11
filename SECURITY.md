# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's
[security advisory form](https://github.com/pete-mc/PowerWiki/security/advisories/new).
That creates a private thread visible only to the maintainer.

Please include what an attacker can achieve, the steps or Markdown that
reproduce it, and the PowerWiki version (shown next to the PowerWiki logo in the
hub header).

You can expect an acknowledgement within a week. Fixes ship as a normal patch
release to the Marketplace; organizations auto-update within a few minutes.

## Supported versions

Only the latest Marketplace release is supported. Azure DevOps auto-updates
installed extensions, so there is no back-porting to older versions.

## What is in scope

PowerWiki runs entirely inside the Azure DevOps host as a browser extension
contribution. It has no backend service, and it stores nothing outside your own
wiki's Git repository.

Most relevant to this project:

- **Rendering untrusted content.** Wiki Markdown is authored by users and
  rendered into the page. Anything that escapes sanitization and executes script
  in the extension iframe is in scope — see `src/rendering/` for the
  sanitization boundary.
- **Privilege boundaries.** PowerWiki requests `vso.wiki_write`, `vso.work`,
  `vso.code`, and `vso.notification_write`. Any path that lets a user reach data
  or actions those scopes should not permit is in scope.
- **Exfiltration.** The extension makes no third-party network calls; a code
  path that sends wiki content anywhere other than the Azure DevOps host is in
  scope.

## What is not in scope

- Vulnerabilities in Azure DevOps itself — report those to
  [Microsoft MSRC](https://msrc.microsoft.com/report).
- The behavior of upstream renderer libraries when used as documented; report
  those upstream, though we still want to know if PowerWiki's use of them is
  what makes an issue exploitable.
- An Azure DevOps user reading or writing wiki content they already have
  permission for through the built-in wiki. PowerWiki deliberately mirrors the
  built-in wiki's permission model.
