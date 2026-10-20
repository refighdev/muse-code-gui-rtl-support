# Changelog

## 0.1.1

### Changed

- **Accounts are now built in.** Named Muse logins (several accounts on one machine, a default per project) no longer depend on a third-party package. Each account is a private pair of folders under `~/.musegui/accounts` that `muse` is pointed at. Accounts created by other tools are not picked up; create them again from the account picker.
- Removed the last third-party package that was specific to this app's origin; the dependency tree is now only general-purpose libraries.

## 0.1.0

### New

- **Right-to-left text support.** Messages, headings, lists, quotes, table cells and the composer take their direction from their own text, so Persian, Arabic and Hebrew read right-to-left and English stays left-to-right, line by line. Code blocks always stay left-to-right.
- **No telemetry.** The app sends nothing about you or your installation anywhere. The update check only asks this repository's GitHub Releases whether a newer version exists.
- **Linux AppImage** built and published by GitHub Actions on every release tag.
