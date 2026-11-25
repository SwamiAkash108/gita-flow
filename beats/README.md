# Beats

Seven built-in practice beats ship with the app (Prasad Lo-Fi 70,
Midnight Boom Bap 76, Kirtan Stepper 82, Vrindavan Nights 88, Mantra Trap 92,
Seva Step 100, Rasa Drill 142) — synthesized live in your browser by the app's
drum machine, no files, zero download, always in perfect sync with the ball.

To use your own loopable instrumentals instead (Artlist tracks work great),
drop the files into this folder and list them in `manifest.json` like this:

```json
{
  "beats": [
    { "name": "Slow Dust", "file": "slow-dust.mp3", "bpm": 84 },
    { "name": "Night Drive", "file": "night-drive.mp3", "bpm": 92 }
  ]
}
```

- `file` is the exact file name in this folder.
- `bpm` is the track's tempo. The app locks the ball to it.
  If you don't know the BPM, set it to 0: the beat plays but the ball
  follows your manual BPM instead (use the TAP button).
- Pick the beat in the trainer with the little selector next to the BPM.
- WAV loops seamlessly; mp3/ogg can add a tiny gap at the loop point.
- The metronome click is always available as the first option.
- `make_beats.py` (not shipped) can render the built-in patterns to WAV if you
  ever want them as files.
