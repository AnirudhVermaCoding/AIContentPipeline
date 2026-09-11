# Music library

Drop royalty-free tracks here and describe them in `music.json`:

```json
{
  "tracks": [
    { "id": "warm-ukulele-01", "file": "warm-ukulele-01.mp3", "mood_tags": ["warm", "acoustic", "ukulele"], "energy": "low", "duration_s": 62, "license": "CC0", "source": "..." }
  ]
}
```

The audio stage picks the track whose tags best match the brand's `music.mood_tags` and `energy`.
When the library has no match the video simply has no music (the decision is logged), except in
mock provider mode where a quiet synthetic bed is generated so the ducking path is exercised.
