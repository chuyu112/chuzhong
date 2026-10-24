import test from 'node:test';
import assert from 'node:assert/strict';
import { mathTopicDetails, searchMathTopics, mathPrerequisitePath } from '../server/math-taxonomy.mjs';
import { createMathPractice, verifyMathPractice, checkMathAnswer, parseMathAnswer, practiceTopicIds, publicMathPractice } from '../server/math-practice.mjs';
import { createMathLearningTurn } from '../server/math-learning.mjs';
import { buildStudentMemory, memoryContext } from '../server/memory.mjs';
import { runTutor } from '../server/tutor.mjs';

const base=()=>({questions:[],attempts:[],observations:[]});
const session=()=>({id:'math-test',hints:0,messages:[]});
const invoke=async(turn,name,args={})=>(await turn.tools.find(t=>t.name===name).execute('call',args)).details;

test('only primary prerequisites and junior mathematics are loaded with stable IDs',()=>{
  assert.equal(mathTopicDetails('cnm_232').name,'y=ax²+bx+c 的图象与性质');
  assert.equal(mathTopicDetails('cne_001'),null);
  assert.ok(searchMathTopics('勾股定理').some(t=>t.id==='cnm_174'));
  const path=mathPrerequisitePath('cnm_235');
  assert.ok(path.length>0);assert.equal(new Set(path.map(t=>t.id)).size,path.length);
  assert.ok(path.every(t=>mathTopicDetails(t.id).grade<=9));
});

test('all supported generators pass checks across varied parameters and reject altered answers',()=>{
  let seed=123;
  const int=(lo,hi)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return lo+seed%(hi-lo);};
  for(const id of practiceTopicIds)for(let i=0;i<40;i++){
    const q=createMathPractice(id,{int});
    assert.equal(verifyMathPractice(q),true,id);
    assert.equal(verifyMathPractice({...q,answer:q.answer+1}),false,id);
    assert.equal(verifyMathPractice({...q,stem:q.stem+'另外条件改变'}),false,id);
    assert.equal(checkMathAnswer(q,String(q.answer)).correct,true,id);
    assert.equal(checkMathAnswer(q,String(q.answer+1)).correct,false,id);
    const visible=publicMathPractice(q);
    for(const key of ['answer','solution','hints','validation'])assert.equal(key in visible,false);
  }
  assert.throws(()=>createMathPractice('cnm_229'),/暂没有/);
});

test('numerical grading does not execute code or misread ambiguous student work',()=>{
  assert.equal(parseMathAnswer('x = -3'),-3);assert.equal(parseMathAnswer('答案是 3/4。'),.75);
  for(const input of ['3/0','x=2或3','我想问2是什么','2+3','1;process.exit()','看不懂','x=2，为什么'])assert.equal(parseMathAnswer(input),null,input);
  const q=createMathPractice('cnm_285',{int:lo=>lo});
  assert.equal(q.answer,2/3);assert.equal(checkMathAnswer(q,'2/3').correct,true);
  const geometry=createMathPractice('cnm_174',{int:lo=>lo});
  assert.match(geometry.stem,/3 cm 和 4 cm/);assert.equal(geometry.answer,5);
});

test('questioning and photograph hypotheses stay provisional and cannot invent text evidence',async()=>{
  const learning=base(),s=session(),turn=createMathLearningTurn({learning,session:s,text:'对称轴为什么这样算'});
  const source={topicId:'cnm_232',evidence:'对称轴为什么这样算',source:'student_text',hypothesis:'先核对是否理解轴对称，尚无实际作答。',prerequisiteId:''};
  assert.match((await invoke(turn,'math_observe',{...source,evidence:'x=2'})).error,/逐字/);
  assert.match((await invoke(turn,'math_observe',{...source,source:'image_reading'})).error,/图片/);
  await invoke(turn,'math_observe',source);
  const saved=turn.finish('一起看顶点。',learning,s).learning;
  assert.equal(learning.observations.length,0,'no persistence until successful response');
  const memory=buildStudentMemory(saved);
  assert.equal(memory.topics[0].topicId,'cnm_232');assert.equal(memory.topics[0].status,'待验证');
  assert.equal(memory.weaknesses.length,0);assert.equal(memory.strengths.length,0);
  assert.match(memoryContext(memory),/对称轴为什么这样算/);
});

test('chat creates a new validated question, checks the reply, preserves assistance and never infers prerequisites mastered',async()=>{
  let learning=base();const s=session();
  const first=createMathLearningTurn({learning,session:s,text:'出一道移项方程考我'});
  const generated=await invoke(first,'math_create_practice',{topicId:'cnm_042'});
  assert.ok(generated.question?.id);
  assert.equal((await invoke(first,'math_check_answer')).status,'not_yet_presented');
  let finalized=first.finish('好，我们试一道。',learning,s);learning=finalized.learning;
  assert.ok(finalized.text.endsWith(finalized.learning.questions[0].stem));
  const q=learning.questions[0];
  const second=createMathLearningTurn({learning,session:s,text:String(q.answer+1)});
  assert.equal((await invoke(second,'math_check_answer')).correct,false);
  assert.equal((await invoke(second,'math_check_answer')).correct,false);
  learning=second.finish('再看一下等式两边。',learning,s).learning;
  assert.equal(learning.attempts.length,1);assert.equal(learning.attempts[0].support,'none');
  const third=createMathLearningTurn({learning,session:s,text:`x=${q.answer}`});
  assert.match(third.verifiedReply,/代入原式核验/);
  assert.doesNotMatch(third.verifiedReply,/你先|你把|你这次/);
  learning=third.finish('对啦！',learning,s).learning;
  assert.equal(learning.attempts.length,2);assert.equal(learning.attempts[1].support,'hint');
  const memory=buildStudentMemory(learning);
  assert.equal(memory.topics.length,1);assert.equal(memory.topics[0].independentQuestions,1);
  assert.equal(memory.strengths.length,0);
  const fourth=createMathLearningTurn({learning,session:s,text:'再来一道'});
  const next=await invoke(fourth,'math_create_practice',{topicId:'cnm_042'});
  assert.notEqual(next.question.id,q.id);
  assert.notEqual(fourth.finish('再试试',learning,s).learning.questions.at(-1).stem,q.stem);
  // A different student's turn cannot access this session's question via a tool.
  const other=createMathLearningTurn({learning:base(),session:{...s},text:String(q.answer)});
  assert.equal((await invoke(other,'math_check_answer')).status,'no_active_question');
});

test('Pi receives and executes the learning tools, including its real tool-result continuation',async()=>{
  const learning=base(),s=session(),turn=createMathLearningTurn({learning,session:s,text:'出一道勾股定理的题'});
  let rounds=0,seen;
  const response=await runTutor({session:s,text:'出一道勾股定理的题',modelId:'glm-5.3-flash',environment:{},learningTools:turn.tools,learningContext:turn.context,
    runModelOverride:async({context})=>{
      rounds++;seen=context;
      if(rounds===1)return {finalText:'勾股定理只适用于直角三角形。',toolCalls:[{id:'practice-call',name:'math_create_practice',arguments:{topicId:'cnm_174'}}]};
      return '先确认哪一条是斜边。';
    }});
  assert.equal(rounds,2);assert.match(JSON.stringify(seen.messages),/直角三角形/);
  assert.match(response,/勾股定理只适用于直角三角形/);
  const saved=turn.finish(response,learning,s);
  assert.equal(saved.learning.questions.length,1);assert.match(saved.text,/自编练习（非真题）/);
});

test('a guided exercise is not called independent, and an unrelated later number is not graded',async()=>{
 let learning=base();const s=session();
 const first=createMathLearningTurn({learning,session:s,text:'解释一下再出一道'});
 await invoke(first,'math_create_practice',{topicId:'cnm_042'});
 learning=first.finish('先记住等式两边同时减去同一个数。',learning,s).learning;
 assert.equal(s.mathLearning.support,'hint');
 const unrelated=createMathLearningTurn({learning,session:s,text:'聊聊唐朝'});
 learning=unrelated.finish('唐朝建立于 618 年。',learning,s).learning;
 const number=createMathLearningTurn({learning,session:s,text:String(learning.questions[0].answer)});
 assert.equal((await invoke(number,'math_check_answer')).status,'needs_clarification');
 assert.equal(number.finish('这个数字是在回答哪一题呢？',learning,s).learning.attempts.length,0);
});
