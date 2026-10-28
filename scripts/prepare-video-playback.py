"""Prepare optional lightweight playback copies; originals and database references are unchanged.
Set EDU_DATA_DIR, FFMPEG_PATH and FFPROBE_PATH for the deployment. Run as the app user.
"""
from pathlib import Path
import sqlite3,json,subprocess,re,os
base=Path(os.environ.get('EDU_DATA_DIR', './data')).resolve()
db=sqlite3.connect('file:'+str(base/'education.sqlite')+'?mode=ro',uri=True)
probe=os.environ.get('FFPROBE_PATH', 'ffprobe')
def inspect(p):
 return json.loads(subprocess.check_output([probe,'-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height','-of','json',str(p)],text=True))
seen=set();report=[]
for document,body in db.execute("SELECT id,body FROM documents WHERE id LIKE 'u:%:session:%'"):
 user=document.split(':')[1]
 if not re.fullmatch(r'[\w-]{1,80}',user):continue
 for message in json.loads(body).get('messages',[]):
  ref=message.get('generatedVideoRef') or {};name=ref.get('filename','')
  if not re.fullmatch(r'[a-f0-9]{64}',name) or (user,name) in seen:continue
  seen.add((user,name));source=base/'videos'/user/name;meta=inspect(source)
  duration=float(meta['format']['duration']);original=source.stat().st_size
  if original/max(duration,1)<110000:continue
  output=base/'video-playback'/user/(name+'.mp4');output.parent.mkdir(parents=True,exist_ok=True,mode=0o750)
  if not output.exists():
   temporary=output.with_suffix('.part.mp4')
   subprocess.run(['nice','-n','10',os.environ.get('FFMPEG_PATH', 'ffmpeg'),'-nostdin','-v','error','-y','-i',str(source),'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','fast','-crf','24','-maxrate','800k','-bufsize','1600k','-threads','1','-c:a','aac','-b:a','96k','-movflags','+faststart',str(temporary)],check=True,timeout=180)
   result=inspect(temporary);assert abs(float(result['format']['duration'])-duration)<.2
   before=next(s for s in meta['streams'] if s['codec_type']=='video');after=next(s for s in result['streams'] if s['codec_type']=='video')
   assert (before['width'],before['height'])==(after['width'],after['height'])
   assert any(s['codec_type']=='audio' for s in result['streams'])
   assert temporary.stat().st_size<original
   temporary.chmod(0o640);os.replace(temporary,output)
  item={'file':name[:10],'originalBytes':original,'playbackBytes':output.stat().st_size,'duration':duration};report.append(item);print(json.dumps(item),flush=True)
db.close();print(json.dumps({'completed':True,'optimized':len(report),'originalBytes':sum(i['originalBytes'] for i in report),'playbackBytes':sum(i['playbackBytes'] for i in report)}),flush=True)
