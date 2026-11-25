# Beats

Drop your own loopable instrumental mp3s into this folder (Artlist tracks work great),
then list them in `manifest.json` like this:

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
- Until you add beats, the built-in metronome click keeps time.
