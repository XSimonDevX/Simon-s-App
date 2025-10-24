# Flashcards AAC App (IndexedDB build)

This build stores images and recordings in **IndexedDB** (not LocalStorage), fixing the `QuotaExceededError` when cards include photos/audio.

## Run
1) Open this folder in VS Code
2) Start Live Server OR run `python -m http.server 8000`
3) Open the app in your browser
4) Install as PWA (optional)

## Notes
- Photos are downscaled to max 512px before saving to reduce size.
- Images/audio are stored as Blobs in IndexedDB and created as object URLs for playback/display.
- Existing LocalStorage `cards` (from previous build) are not used in this build.
