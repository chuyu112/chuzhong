#!/usr/bin/env python3
"""Transcribe the actual video audio locally; no student data leaves the server."""
import argparse
import json
import os
import subprocess
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--model', required=True)
    args = parser.parse_args()
    import numpy as np
    from faster_whisper import WhisperModel
    model_path = Path(args.model).resolve()
    if not model_path.is_dir():
        raise ValueError('Local speech model missing')
    decoded = subprocess.run([os.environ.get('FFMPEG_PATH', 'ffmpeg'), '-nostdin', '-v', 'error', '-i', args.source,
                              '-t', '45', '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'],
                             capture_output=True, check=True, timeout=30)
    samples = np.frombuffer(decoded.stdout, dtype='<f4').copy()
    if not 16000 <= len(samples) <= 45 * 16000 or float(np.max(np.abs(samples))) < .005:
        raise ValueError('Video has no usable speech')
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=2,
                         local_files_only=True)
    segments, info = model.transcribe(samples, language='en', beam_size=5, temperature=0,
                                     word_timestamps=True, condition_on_previous_text=False,
                                     vad_filter=False)
    words = []
    for segment in segments:
        for word in segment.words or []:
            start, end = float(word.start), float(word.end)
            # Whisper can include a leading silence in a word's interval.
            # Trim only quiet edges within that interval, never move a word to
            # a planned script time or synthesize an unheard word.
            lo, hi = int(start * 16000), min(len(samples), int(end * 16000))
            clip = samples[lo:hi]
            if len(clip) >= 640:
                blocks = clip[:len(clip) // 160 * 160].reshape(-1, 160)
                rms = np.sqrt(np.mean(blocks * blocks, axis=1))
                active = np.flatnonzero(rms >= max(.002, float(rms.max()) * .10))
                if len(active):
                    start = max(start, start + int(active[0]) * .01 - .03)
                    end = min(end, lo / 16000 + (int(active[-1]) + 1) * .01 + .04)
            words.append({'word': word.word.strip(), 'start': round(start, 3),
                          'end': round(end, 3), 'probability': round(float(word.probability), 4)})
    Path(args.output).write_text(json.dumps({'version': 1, 'engine': 'faster-whisper-base.en',
                                          'duration': len(samples) / 16000, 'words': words}))
    os.chmod(args.output, 0o600)

if __name__ == '__main__':
    main()
