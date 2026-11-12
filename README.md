# Cutroom

A video editor that runs entirely in the browser. Files never leave the device.

## Run it

You need Node.js 20 or newer.

```
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173). Use Chrome or Edge.

If `npm install` fails while setting up `onnxruntime-node`, run `npm install --ignore-scripts` instead. That package is only a side dependency of the speech library and is not used in the browser.

`npm run build` type-checks and writes a static site to `dist/`, which can be hosted anywhere.

## What it does today

- Import video, audio and images. Trim, split, duplicate, reorder, undo and redo.
- Multiple tracks: a main video track plus any number of video layers, text tracks and audio tracks. Higher tracks draw in front. Tracks can be hidden or muted.
- Picture-in-picture: move, resize and rotate any picture or text directly on the preview; crop, opacity and exact values in the inspector.
- Timeline: snapping to the playhead and clip edges, filmstrip thumbnails, audio waveforms, multi-select (Shift-click) and group moves, dragging clips between tracks.
- Transitions between main-track clips: crossfade, dip to black, wipe, slide, push and zoom, with matching audio crossfades.
- Keyframes: animate position, size, rotation, opacity and volume over time. Press the diamond beside a setting to add one at the playhead.
- Speech to text (Transcript tab): Whisper runs in a worker on the GPU or CPU, with word-level timing, in many languages. The model is downloaded from Hugging Face on first use and cached.
- Auto captions from the transcript, as ordinary text clips you can restyle (one click applies a style to all).
- Edit by transcript: select words and delete them to cut the video. One-click removal of filler words and of silences.
- Text overlays with fonts, colours, background box and entrance animations.
- Per-clip volume, mute and audio fades.
- Preset looks, colour and blur sliders, speed changes, fades.
- Export to MP4 (WebM as a fallback) at 720p or 1080p, 30 or 60 fps, rendered offline frame by frame.
- Autosave: the project and its media are kept in the browser (IndexedDB) and restored on reload.

## How the code is laid out

| File | Job |
| --- | --- |
| `src/types.ts` | The project model: clips, tracks, media |
| `src/state.ts` | The single app state, undo history, change notifications |
| `src/media.ts` | Media library, file probing, thumbnails, sample clips |
| `src/render.ts` | The compositor. Preview and export both call `renderFrame` |
| `src/playback.ts` | Real-time preview: clock, media elements, Web Audio graph |
| `src/export.ts` | Offline export with WebCodecs through the `mediabunny` library |
| `src/storage.ts` | Autosave to IndexedDB |
| `src/speech.ts` | Audio extraction, silence detection, windowed transcription, caption line breaking |
| `src/asrWorker.ts` | The Whisper worker (transformers.js) |
| `src/speechActions.ts` | Remove silences, captions, cut by transcript, filler removal |
| `src/ui/transcript.ts` | The Transcript tab |
| `src/actions.ts` | Editing commands: add, split, duplicate, delete, tracks, import |
| `src/ui/timeline.ts` | Timeline rows, clip artwork, snapping, dragging |
| `src/ui/stage.ts` | Move, resize and rotate handles on the preview |
| `src/ui/*` | Inspector, media list, export dialog |

The rule that keeps preview and export identical: anything visual goes in `render.ts`, and it must depend only on the project and a time, never on the DOM or the wall clock.

## Known limits

- The main track is sequential (no gaps); layers above it are free. Transitions exist only between main-track clips.
- Keyframes cannot be dragged on the timeline yet; remove and re-add one to retime it. Position, size and rotation ease in and out; opacity and volume are linear.
- Crop is set with sliders, not by dragging on the preview.
- Waveforms are skipped for audio files over 300 MB.
- Export decodes each source's whole audio into memory, so very long files (roughly an hour and up) may run out of memory.
- Speed changes keep pitch in the preview but shift pitch in the export.
- Colour filters use the canvas `filter` property, which Safari does not fully support.
- Transcription and silence removal decode the whole file's audio in memory.
- Captions are one line per clip, without word-by-word highlighting. There is no SRT export yet.
- Cutting by transcript is only as precise as the recogniser's word timing.
- The UI is plain TypeScript without a framework.

## Roadmap

1. Engine (this stage): codebase, fast export, autosave.
2. Editing depth (done): multiple tracks, snapping, thumbnails, waveforms, transforms, transitions, keyframes.
3. Differentiators (done, first version): in-browser auto captions, edit by transcript, silence and filler removal.
4. Everything else: recording, green screen, background removal, audio clean-up, templates, platform presets.
