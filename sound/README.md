# Pattern Machine

An original browser instrument: six pitched lanes, a synthesized kick/snare/hat kit, two sixteen-step bars, and a live view of the sound it produces. Plain HTML, CSS and JavaScript. No libraries, samples, API keys, accounts or network audio requests.

## Run

Serve the project collection's root over HTTP:

```sh
python3 -m http.server 8000
```

Open `/sound/`. ES modules require an HTTP server; opening the HTML as a local `file://` URL is not supported. From the standalone source package, run the same command in the extracted package folder and choose Pattern Machine.

## Make a loop

- Press **Play loop**. Audio starts only after this explicit action.
- Tap a pad to toggle a hit. **Accent** paints louder hits; Shift-click or the **A** key toggles an accent on the focused pad.
- Click a track name to mute or unmute it. Melody and percussion use independent lanes.
- **A** and **B** select separate bars. **A → B** chains both bars; otherwise the selected bar loops.
- Try **After hours**, **Daylight**, or **Night drive** as starting grooves. Each has a different second bar.
- **Glass**, **Warm** and **Brass** change the additive melody voice. Choose a root and major/minor pentatonic scale.
- Set 50–180 BPM with the number field, ±5 controls, or Tap tempo. Swing redistributes paired sixteenths while preserving the duration of a complete bar.
- **Make a variation** changes a few melody and hat steps while keeping the kick/snare pulse. **Copy** duplicates the selected bar into the other bank.
- **Undo** restores up to 24 edits, including cleared bars, imports and preset changes. Undo history lasts for this page visit.

## Keyboard and touch

The pad grid uses one roving keyboard focus: arrows move, Home/End jump within a row, Ctrl+Home/End jump to the grid's corners, Space/Enter toggles, A accents, and Delete/Backspace erases. Escape stops playback. Track mutes and other controls are ordinary labeled buttons. On narrow screens, swipe horizontally through the grid; melody pads remain 40 × 42 CSS pixels, with separate round percussion pads. Keyboard navigation scrolls the pad grid without scrolling the whole page.

The oscilloscope shows actual analyser samples from the audio output. Frequency bars also reflect the live signal; no prerecorded or decorative waveform is presented as live data. Reduced-motion mode updates the analyser display at most four times per second. The musical playhead remains available for timing.

## Save and export

The latest valid session is saved in `localStorage` under `brandon-pattern-machine-v2`. Storage failure is shown visibly; it does not prevent composition. There is no cloud sync. Export a JSON file to keep or move a session.

Imported files must be at most 64 KB and contain exactly two 9 × 16 pattern grids with values 0, 1 or 2, valid settings, and bounded numeric fields. Validation copies only recognized fields. File content is never evaluated or inserted as HTML. Importing stops playback and remains undoable.

**Download audio .wav** uses `OfflineAudioContext` to render locally. It exports the selected bar, or A followed by B when chaining is enabled, at 44.1 kHz, stereo, 16-bit PCM. It respects swing, voice, root, scale, mutes and output level. Three repetitions are rendered and the middle is extracted so note tails carry through the loop boundary. It is a loop export, not a recording of live edits. If offline rendering is unavailable, editable JSON export still works.

## Timing and audio design

`model.js` contains pure state, timing, import, MIDI and WAV logic. `audio.js` contains the synth voices and audio graph. `app.js` owns UI and transport lifecycle.

A 25 ms JavaScript lookahead timer schedules notes on `AudioContext.currentTime` approximately 120 ms ahead. The timer does not set the note onset itself. A delayed callback skips stale events rather than playing a burst of old notes. Visual step changes follow queued audio-clock timestamps. Live edits affect events that have not yet been scheduled, so a small lookahead delay is expected.

Each pitched hit uses one periodic-wave oscillator. Kick uses a descending sine, snare combines filtered deterministic noise with a short tonal body, and hat uses high-pass filtered noise. All voices use gain envelopes; an output compressor and three bounded gain presets manage the summed signal. They do not control the listener's physical device volume. The default is Quiet.

Playback stops when the document is hidden, during audio-context interruption, on Escape, or when Stop is pressed. Stops fade the master and cancel scheduled sources. Sources disconnect on completion. Starting is guarded against duplicate clicks and audio permission timeouts. No automatic resume or autoplay is attempted.

## Verification

From the repository root:

```sh
node --test tests/sound.test.mjs
```

Ten tests cover preset integrity, import rejection, swing/bar duration, pattern bank order, scheduler drift and delayed-callback behavior, variation invariants, MIDI conversion, WAV header/interleaving/clipping, and muted-track counts. The standalone package uses the same tests with rewritten relative imports.

Browser QA should additionally check Play/Stop, changing voices while playing, pause on switching tabs, mobile horizontal scrolling, keyboard pad navigation, session reload, JSON import/export and WAV download. Sound output and browser-specific rendering require listening checks on real devices; deterministic tests cannot establish perceptual quality or device latency.

## Limitations

This is a small creative instrument, not a DAW. It has no microphone recording, MIDI hardware support, sample import, automation, unlimited tracks or collaboration. Playback timing depends on the browser and device; suspending the page stops playback instead of attempting background audio. Brass is a synthetic timbre, not a trumpet recording. Browser audio policies can require another Play press after an interruption. WAV export requires offline audio support.

## Primary references

- [MDN: Creating and sequencing audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques) — lookahead scheduling with an audio-clock timeline.
- [Web Audio API specification](https://www.w3.org/TR/webaudio/) — scheduled source nodes, periodic waves, analyser nodes and offline audio contexts.
- [MDN: OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext) — local offline rendering.
