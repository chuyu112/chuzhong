# English video speech alignment

English video planning uses `teachingVersion:3`: estimate natural speech first, perform the main exchange once, explain necessary expressions and add a distinct example when the content is short. Scene lengths follow content, not a fixed normal/slow/repeat template. Existing v2 briefs remain readable for already submitted jobs.

Production downloads the original video, transcribes its actual audio locally, verifies the ordered spoken text against the approved brief and burns bilingual subtitles at the detected speech times. Missing or unreliable speech produces a recoverable failure instead of guessed captions. Recognition/runtime outages reuse the original remote video. A confirmed speech/script mismatch may create a new attempt only after the student's explicit conversational retry.

## Runtime

- Python 3.11+ virtual environment at `/opt/zhixu-study/asr-venv`; install `scripts/video-asr-requirements.txt`.
- Local CTranslate2 model `Systran/faster-whisper-base.en` at `/opt/zhixu-study/asr-models/base.en`, containing `model.bin`, `config.json`, `tokenizer.json` and `vocabulary.txt` from the same model revision. Download during deployment; generation never downloads a model.
- The service user needs read and execute access to the virtual environment and model directory. ffmpeg, ffprobe and subtitle fonts are still required.
- Optional overrides: `EDU_VIDEO_ASR_PYTHON`, `EDU_VIDEO_ASR_MODEL`, `FFMPEG_PATH`.
- Speech recognition runs one at a time, CPU/int8 with two threads, and has a 120-second limit. Source audio stays on the server; temporary files are removed after processing.

Check the runtime as the service user before switching a release:

```sh
/opt/zhixu-study/asr-venv/bin/python scripts/align-video-speech.py input.mp4 timing.json --model /opt/zhixu-study/asr-models/base.en
```

The private job's `mediaAudit` records actual cue times and recognition engine. No extra controls or technical details are added to the child's UI.
