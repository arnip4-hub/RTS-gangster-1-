# Windows branding

The Windows Setup and Portable executables have a separate RTS Gangster 1 icon.
The interactive NSIS setup and uninstaller also use matching 1930s city artwork.

The branding is **derived automatically**, not checked in as binaries:
- Source art: public/art/brand/key-art-city.jpg
- Generated multi-resolution .ico: build/windows/rts-gangster.ico
- Generated 24-bit installerSidebar.bmp and uninstallerSidebar.bmp: 164 x 314 px
- Generated 24-bit installerHeader.bmp: 150 x 57 px

Run npm run branding:win to regenerate the assets, or use npm run package:win
to regenerate and build the installer and portable executable automatically.

The icon has raster sizes 16, 24, 32, 48, 64, 128 and 256 px. It is used by
the packaged Windows app, its shortcuts, Setup and the uninstaller. The BMPs
are correctly encoded as 24-bit uncompressed RGB for NSIS.

## Compatibility

This change deliberately **does not** change the existing appId,
com.originalgangster.game, or the existing user data folder,
%APPDATA%\Original Gangster. Changing appId now could cause an existing beta
installation to be installed side-by-side rather than upgraded. Existing saved
games and installer upgrade behavior remain intact. Renaming the internal
application identity should be a separate, tested migration.
