"""Generate an original 48-second ambient bed without external media."""
import math
import struct
import wave

rate = 22050
seconds = 48
chords = [(110.0, 130.81, 164.81), (87.31, 130.81, 174.61),
          (130.81, 164.81, 196.00), (98.0, 123.47, 146.83)]
with wave.open('out/music.wav', 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(rate)
    buf = bytearray()
    for i in range(rate * seconds):
        t = i / rate
        chord = chords[int(t // 6) % len(chords)]
        fade = min(1, t / 2, (seconds - t) / 3)
        chord_time = t % 6
        envelope = min(1, chord_time / .8, (6 - chord_time) / .8)
        pad = sum(math.sin(2 * math.pi * f * t) + .18 * math.sin(4 * math.pi * f * t) for f in chord) * .037 * envelope
        note_time = t % .6
        note = chord[int(t / .6) % 3] * 2
        pluck = (math.sin(2 * math.pi * note * t) + .25 * math.sin(4 * math.pi * note * t)) * math.exp(-note_time * 5) * .034
        sample = max(-1, min(1, (pad + pluck) * fade))
        buf.extend(struct.pack('<h', round(sample * 32767)))
    audio.writeframes(buf)
