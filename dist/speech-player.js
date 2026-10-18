import { speechText } from './core.js';
import { resolveVoice, SPEAKER_NAMES } from './voice-options.js';

export function createSpeechPlayer({ toast }) {
 let active=null;
 const bar=document.getElementById('speech-bar'),status=document.getElementById('speech-status'),stopButton=document.getElementById('speech-stop');
 function finish(item){
  if(active!==item)return;
  active=null;item.controller?.abort();item.audio?.pause();
  if(item.url)URL.revokeObjectURL(item.url);
  item.onState?.('idle');bar.hidden=true;
 }
 function stop(){const item=active;if(item)finish(item);window.speechSynthesis?.cancel();}
 async function toggle({text,voice,button,onState}){
  if(active?.button===button){
   const item=active;
   if(item.state==='loading'){stop();return;}
   if(item.state==='playing'){
    item.state='paused';if(item.audio)item.audio.pause();else window.speechSynthesis?.pause();
    status.textContent='已暂停';item.onState?.('paused');return;
   }
   try{if(item.audio)await item.audio.play();if(active!==item){item.audio?.pause();return;}item.state='playing';status.textContent='正在朗读';item.onState?.('playing');}
   catch{finish(item);toast('未能继续播放，请重新点朗读。');}return;
  }
  stop();
  const spoken=speechText(text.match(/朗读版[：:]([\s\S]*)/)?.[1]||text).trim();
  if(!spoken)return toast('这条消息没有可朗读的内容。');
  const item={button,onState,state:'loading',controller:new AbortController()};active=item;bar.hidden=false;status.textContent='正在准备语音';onState?.('loading');
  const playing=()=>{if(active!==item)return;item.state='playing';status.textContent='正在朗读';onState?.('playing');};
  const failed=message=>{if(active!==item)return;finish(item);toast(message);};
  try{
    const response=await fetch('/api/speech',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:spoken,voice:resolveVoice(voice?.name),rate:voice?.rate??1}),signal:item.controller.signal});
    if(!response.ok){const result=await response.json();throw new Error(result.error||'语音暂时无法播放，请稍后再试。');}
    const blob=await response.blob();if(active!==item)return;
    const speaker=response.headers.get('x-speech-voice');if(speaker&&SPEAKER_NAMES[speaker])status.textContent=`正在朗读 · ${SPEAKER_NAMES[speaker]}`;
    item.url=URL.createObjectURL(blob);item.audio=new Audio(item.url);
    item.audio.onended=()=>finish(item);item.audio.onerror=()=>failed('音频未能播放，请再点一次朗读。');
    try{await item.audio.play();}
    catch(error){
     if(active!==item)return;
     // Some mobile browsers require another tap after the network response.
     if(error.name==='NotAllowedError'){item.state='paused';status.textContent='语音已准备好，点继续朗读';onState?.('paused');return;}
     throw new Error('音频未能播放，请再点一次朗读。');
    }
    if(active!==item){item.audio.pause();return;}playing();
  }catch(error){if(active!==item||item.controller.signal.aborted)return;failed(error.message);}
 }
 stopButton.onclick=stop;
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',stop);
 return {toggle,stop,isActive:()=>Boolean(active)};
}
