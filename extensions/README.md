# Extensions

This directory is the shared home for browser and client extensions that integrate with Zukan.

## Layout

- `save-to-zukan-chrome/`: unpacked Chrome Manifest V3 extension for saving images and videos into Zukan

## Conventions

- Each extension lives in its own subdirectory
- Each extension owns its own manifest, assets, and local package metadata
- Shared code between extensions should move into a dedicated `extensions/shared/` directory only when a second extension actually needs it

## Current extension

To load the Chrome extension in developer mode, select:

`extensions/save-to-zukan-chrome/`
