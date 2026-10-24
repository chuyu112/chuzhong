#!/usr/bin/env python3
"""Import the pinned junior-math subset as data; never execute upstream verify code."""
import collections
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
COMMIT = 'e6d69137c01468a9c03cbb4ceceba0cfc1d50cca'
SOURCE_SHA = '12c605c6aed36d8d3c9e073a0325a17ca09e3473e63dc250c96f7c602e58c99f'
TAGS = set('svg path line ellipse polygon circle rect text defs marker'.split())
ATTRS = set('viewBox d fill stroke stroke-width stroke-dasharray stroke-linejoin stroke-linecap x1 y1 x2 y2 cx cy rx ry fill-opacity points r x y width height font-family font-weight font-size text-anchor id markerWidth markerHeight refX refY orient marker-end'.split())
ET.register_namespace('', 'http://www.w3.org/2000/svg')

def safe_svg(text):
    if len(text) > 30000 or re.search(r'<!|<\?', text):
        raise ValueError('unsupported_svg')
    root = ET.fromstring(text)
    if root.tag != '{http://www.w3.org/2000/svg}svg':
        raise ValueError('unsupported_svg')
    for el in root.iter():
        if el.tag.removeprefix('{http://www.w3.org/2000/svg}') not in TAGS:
            raise ValueError('unsupported_svg_element')
        for key, value in el.attrib.items():
            if key not in ATTRS or re.search(r'javascript:|data:|https?:|[<>]', value, re.I):
                raise ValueError('unsupported_svg_attribute')
            if 'url(' in value and not re.fullmatch(r'url\(#[\w-]+\)', value):
                raise ValueError('external_svg_reference')
    return ET.tostring(root, encoding='unicode')

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def main(source):
    raw = Path(source).read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA:
        raise ValueError('Source differs from the audited pinned version; review the import before updating it.')
    topics = {t['id']: t for t in json.loads((ROOT/'vendor/cn-math-taxonomy/curriculum.json').read_text())['topics'] if 7 <= t['grade'] <= 9}
    records, seen, stems = [], set(), set()
    for original in json.loads(raw):
        if original.get('topicId') not in topics:
            continue
        q = dict(original); issues = []
        if not re.fullmatch(r'cnm_\d{3}_q\d+', q.get('id', '')) or q['id'] in seen:
            issues.append('invalid_or_duplicate_id')
        seen.add(q['id'])
        for field in ['prompt', 'answer', 'explanation']:
            if not isinstance(q.get(field), str) or not q[field].strip():
                issues.append('missing_'+field)
        if q.get('type') not in ['numeric', 'choice', 'short', 'self']:
            issues.append('unknown_type')
        if q.get('difficulty') not in ['basic', 'standard', 'advanced']:
            issues.append('unknown_difficulty')
        if q.get('type') == 'choice':
            choices = q.get('choices', []); keys = [c.get('key') for c in choices]
            if not 2 <= len(choices) <= 8 or len(set(keys)) != len(keys) or q['answer'] not in keys or any(not c.get('text') for c in choices):
                issues.append('invalid_choices')
            if q.get('hideChoiceText') and not all(c.get('figure') for c in choices):
                issues.append('missing_option_figure')
        if re.search(r'如图|下图|右图|左图|图示', q['prompt']) and not q.get('figure'):
            issues.append('missing_required_figure')
        signature = re.sub(r'\s+', '', q['prompt']) + canonical(q.get('choices', []))
        if signature in stems:
            issues.append('duplicate_question')
        stems.add(signature)
        try:
            if q.get('figure'):
                q['figure'] = safe_svg(q['figure'])
            if q.get('choices'):
                q['choices'] = [{**c, **({'figure': safe_svg(c['figure'])} if c.get('figure') else {})} for c in q['choices']]
        except (ValueError, ET.ParseError) as e:
            issues.append(str(e))
        q['audit'] = {'status': 'quarantined' if issues else 'pending_review', 'issues': issues,
                      'contentHash': hashlib.sha256(canonical(q).encode()).hexdigest(),
                      'note': '结构检查不等于答案正确。出题前独立模型复核；未经过教师审核。上游 verify 字段仅作为原始数据保存，不执行。'}
        records.append(q)
    assert len(records) == 1407 and len(topics) == 315
    counts = {'total': len(records), 'topics': len(set(q['topicId'] for q in records)),
              'types': dict(collections.Counter(q['type'] for q in records)),
              'status': dict(collections.Counter(q['audit']['status'] for q in records)),
              'questionsWithFigures': sum(bool(q.get('figure') or any(c.get('figure') for c in q.get('choices', []))) for q in records)}
    data = {'source': 'https://github.com/xiaoyang111222/cn-math-taxonomy', 'commit': COMMIT,
            'sourceFile': 'data/questions.json', 'sourceSha256': SOURCE_SHA, 'license': 'CC-BY-NC-4.0',
            'importVersion': 1, 'counts': counts, 'questions': records}
    (ROOT/'vendor/cn-math-taxonomy/questions-junior.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'))+'\n')
    (ROOT/'vendor/cn-math-taxonomy/question-import-report.json').write_text(json.dumps({**{k:v for k,v in data.items() if k!='questions'}, 'quarantined': [{'id':q['id'], 'issues':q['audit']['issues']} for q in records if q['audit']['issues']]}, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(counts, ensure_ascii=False))

if __name__ == '__main__':
    main(sys.argv[1])
