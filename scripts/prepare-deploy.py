#!/usr/bin/env python3
"""Package the server, verified papers and a consistent learning-data snapshot.

Credentials are deliberately excluded and must be transferred separately over SSH.
"""
from pathlib import Path
import hashlib
import json
import os
import sqlite3
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT.parent / '真题库'
OUT = ROOT / 'artifacts' / 'deployment'
OUT.mkdir(parents=True, exist_ok=True)
OUT.chmod(0o700)
manifest = json.loads((BANK / 'download-manifest.json').read_text())
papers = [p for p in manifest['papers'] if p['status'] == 'downloaded']
entries = []

for name in ['server', 'dist', 'vendor', 'skills', 'scripts/copy-assets.mjs', 'package.json', 'package-lock.json']:
    source = ROOT / name
    for file in sorted(source.rglob('*')) if source.is_dir() else [source]:
        if file.is_file() and file.name != '.DS_Store':
            entries.append((file, 'app/' + file.relative_to(ROOT).as_posix()))
entries.append((BANK / 'download-manifest.json', 'archive/download-manifest.json'))
for paper in papers:
    file = (BANK / paper['relativePath']).resolve()
    if not file.is_relative_to(BANK.resolve()) or not file.is_file():
        raise RuntimeError('Invalid or missing paper in manifest')
    with file.open('rb') as stream:
        if stream.read(5) != b'%PDF-':
            raise RuntimeError('Invalid PDF in manifest')
    entries.append((file, 'archive/' + file.relative_to(BANK).as_posix()))

for name in ['homework', 'papers/shenzhen-2023-2024-recalled.pdf']:
    source = ROOT / 'data' / name
    if source.exists():
        for file in sorted(source.rglob('*')) if source.is_dir() else [source]:
            if file.is_file() and file.name != '.DS_Store':
                entries.append((file, 'initial-data/' + file.relative_to(ROOT / 'data').as_posix()))

target = OUT / 'zhixu-study.tar.gz'
with tempfile.TemporaryDirectory(dir=OUT) as temporary:
    database = ROOT / 'data' / 'education.sqlite'
    if database.exists():
        snapshot = Path(temporary) / 'education.sqlite'
        with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(snapshot) as dest:
            source.backup(dest)
            if dest.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Learning database integrity check failed')
        entries.append((snapshot, 'initial-data/education.sqlite'))

    def portable(info):
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        info.mode = 0o600 if info.name.startswith('initial-data/') else 0o644
        return info

    with tarfile.open(target, 'w:gz') as archive:
        for file, name in entries:
            archive.add(file, arcname=name, recursive=False, filter=portable)
os.chmod(target, 0o600)
with target.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hashlib.sha256(stream.read()).hexdigest()
report = {'archive': target.name, 'bytes': target.stat().st_size, 'sha256': digest, 'papers': len(papers), 'files': len(entries), 'credentialsIncluded': False}
(OUT / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
