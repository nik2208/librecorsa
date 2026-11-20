App versions of LibreCorsa that open the live site at https://librecorsa.org/play, so they stay as current as the site. Built by GitHub Actions from this tag's source (`.github/workflows/release-desktop.yml`).

## Downloads
- **Windows (x64):** the `win-x64-Setup.exe`
- **macOS (Apple Silicon):** the `mac-arm64.dmg`
- **macOS (Intel):** the `mac-x64.dmg`
- **Linux (x64):** the `linux-x86_64.AppImage`

## Opening unsigned builds
- **Windows:** if SmartScreen stops it, click **More info**, then **Run anyway**.
- **macOS:** allow it in System Settings > Privacy & Security, or run `xattr -cr /Applications/LibreCorsa.app`.
- **Linux:** run `chmod +x` on the AppImage, then open it.

## Code signing policy
Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org). Windows signing is being set up. Who builds, reviews and approves releases, and what the app sends, is in the [code signing policy](https://github.com/KhazP/librecorsa#code-signing-policy).
