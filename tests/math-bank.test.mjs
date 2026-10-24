import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {bankSummary,bankRecord,bankCandidates,bankTopicCount,bankFigure,createBankPractice,compareBankAnswer,checkBankAnswer,bankStem} from '../server/math-question-bank.mjs';
import {reviewMathBankQuestion} from '../server/math-bank-review.mjs';
import {publicMathPractice} from '../server/math-practice.mjs';
import {createMathLearningTurn} from '../server/math-learning.mjs';
import {buildStudentMemory} from '../server/memory.mjs';

const approve=q=>({status:'model_checked',version:1,questionHash:q.audit.contentHash,answer:q.answer,referenceConsistent:true,modelId:'test-model',reason:'独立核对依据。',hint:'先看条件。'});
const invoke=async(turn,name,args={})=>(await turn.tools.find(t=>t.name===name).execute('call',args)).details;

test('pinned import preserves 1407 questions, all 315 topics, source IDs and 51 illustrated questions',()=>{
 assert.equal(bankSummary.total,1407);assert.equal(bankSummary.topics,315);assert.equal(bankSummary.questionsWithFigures,51);
 assert.deepEqual(bankSummary.types,{numeric:903,choice:475,self:6,short:23});
 for(let i=1;i<=315;i++)assert.ok(bankTopicCount('cnm_'+String(i).padStart(3,'0'))>0);
 assert.equal(bankRecord('cnm_p001_q1'),null);assert.equal(bankRecord('cne_001_q1'),null);
 assert.equal(bankRecord('cnm_001_q1').audit.status,'pending_review');
 assert.ok(bankRecord('cnm_001_q1').verify.includes('Fraction'));
 const used=bankCandidates('cnm_001')[0];assert.ok(!bankCandidates('cnm_001',{usedIds:[used.id]}).some(q=>q.id===used.id));
});

test('numeric sets, fractions, options and symbolic answers are graded conservatively',()=>{
 assert.equal(compareBankAnswer(bankRecord('cnm_001_q1'),'-1/2，-3').correct,true);
 assert.equal(compareBankAnswer(bankRecord('cnm_093_q1'),'1,2,3').correct,true);
 assert.equal(compareBankAnswer(bankRecord('cnm_093_q1'),'3,2,1').correct,false);
 assert.equal(compareBankAnswer(bankRecord('cnm_093_q1'),'1').status,'needs_clarification');
 assert.equal(compareBankAnswer(bankRecord('cnm_001_q2'),'我选B').correct,true);
 assert.equal(compareBankAnswer(bankRecord('cnm_001_q2'),'A').correct,false);
 assert.equal(compareBankAnswer(bankRecord('cnm_001_q2'),'B还是C').status,'needs_clarification');
 assert.equal(compareBankAnswer(bankRecord('cnm_025_q1'),'b+a=a+b').correct,true);
 assert.equal(compareBankAnswer(bankRecord('cnm_026_q1'),'3*a*b').correct,true);
 assert.equal(compareBankAnswer(bankRecord('cnm_025_q1'),'c+d=d+c').status,'needs_review');
 assert.equal(compareBankAnswer(bankRecord('cnm_003_q1'),'正数有3.5和7').status,'needs_review');
 for(const text of ['1/0','2**4','process.exit()'])assert.equal(compareBankAnswer(bankRecord('cnm_002_q2'),text).status,'needs_clarification');
});

test('answers, solutions and review answers stay private until an actual answer is submitted',()=>{
 const source=bankRecord('cnm_001_q2');
 assert.throws(()=>createBankPractice(source,{status:'pending_review'}),/复核/);
 const q=createBankPractice(source,approve(source)),visible=publicMathPractice(q);
 for(const key of ['answer','solution','bankReview','validation','hints'])assert.equal(key in visible,false);
 assert.equal(q.bankId,source.id);assert.ok(q.sourceUrl.includes(bankSummary.commit));
 assert.equal(checkBankAnswer(q,'B').correct,true);
 assert.equal(checkBankAnswer({...q,stem:q.stem+'篡改'},'B').status,'invalid_question');
 assert.equal(checkBankAnswer({...q,bankReview:approve(bankRecord('cnm_002_q2'))},'B').status,'invalid_question');
});

test('independent review sees no answer key, caches approved work and rejects mismatches',async()=>{
 const question=bankRecord('cnm_002_q2'),cache=new Map();let calls=0;
 const options={question,modelId:'glm-5.3-flash',environment:{},readReview:k=>cache.get(k),saveReview:(k,v)=>cache.set(k,v),runModelOverride:async({context})=>{
  calls++;const content=JSON.stringify(context.messages);
  assert.doesNotMatch(content,/referenceAnswer|"verify"|"explanation"/);
  return JSON.stringify({valid:true,answer:'-35',reason:'低于海平面记为负，数值为35。',hint:'答案是-35'});
 }};
 const review=await reviewMathBankQuestion(options);
 assert.equal(review.status,'model_checked');assert.doesNotMatch(review.hint,/-35/);
 await reviewMathBankQuestion(options);assert.equal(calls,1);
 const rejected=await reviewMathBankQuestion({...options,readReview:()=>null,runModelOverride:async()=>JSON.stringify({valid:true,answer:'35',reason:'错误复核'})});
 assert.equal(rejected.status,'rejected');
 let saved=false;await assert.rejects(reviewMathBankQuestion({...options,readReview:()=>null,saveReview:()=>{saved=true;},runModelOverride:async()=>'{bad JSON'}),/未完成/);assert.equal(saved,false);
});

test('bank practice uses distinct source questions, shares one concurrent review and persists accurate evidence',async()=>{
 const s={id:'bank-chat',messages:[]},learning={questions:[],attempts:[],observations:[]};let reviews=0;
 const turn=createMathLearningTurn({learning,session:s,text:'从题库选一道题',reviewBankQuestion:async q=>{reviews++;await new Promise(r=>setTimeout(r,10));return approve(q);}});
 const results=await Promise.all([invoke(turn,'math_select_bank_question',{topicId:'cnm_050',difficulty:'basic'}),invoke(turn,'math_select_bank_question',{topicId:'cnm_050',difficulty:'basic'})]);
 assert.equal(reviews,1);assert.equal(results[0].question.id,results[1].question.id);
 assert.equal((await invoke(turn,'math_check_answer')).status,'not_yet_presented');
 const saved=turn.finish('一起试试。',learning,s);assert.equal(saved.learning.questions.length,1);
 const q=saved.learning.questions[0];assert.equal(q.type,'math-bank');assert.equal(q.bankId,'cnm_050_q1');assert.equal(saved.practiceFigures.length,5);
 assert.ok(saved.text.includes(bankStem(bankRecord(q.bankId))));assert.match(saved.text,/题库练习（非真题）/);
 const answer=createMathLearningTurn({learning:saved.learning,session:s,text:'我选C'});
 assert.match(answer.verifiedReply,/结果正确/);
 const updated=answer.finish(answer.verifiedReply,saved.learning,s).learning;
 assert.equal(updated.attempts[0].bankId,q.bankId);assert.equal(updated.attempts[0].correct,true);
 assert.equal(buildStudentMemory(updated).strengths.length,0);
 const next=createMathLearningTurn({learning:updated,session:s,text:'再来一道',reviewBankQuestion:async q=>approve(q)});
 const receipt=await invoke(next,'math_select_bank_question',{topicId:'cnm_050',difficulty:'basic'});
 assert.notEqual(receipt.question.bankId,q.bankId);
 const failed=createMathLearningTurn({learning,session:{id:'failed'},text:'出题',reviewBankQuestion:async()=>({status:'rejected'})});
 assert.match((await invoke(failed,'math_select_bank_question',{topicId:'cnm_050',difficulty:'basic'})).error,/未通过复核/);
 assert.equal(failed.finish('先讲清楚。',learning,{}).learning.questions.length,0);
});

test('source SVGs retain figures; importer refuses scripts, event handlers and external resources',()=>{
 assert.match(bankFigure('cnm_050_q1','question'),/<svg/);
 assert.match(bankFigure('cnm_050_q1','A'),/<polygon/);
 assert.equal(bankFigure('cnm_050_q1','X'),null);
 const program=`import importlib.util
spec=importlib.util.spec_from_file_location('bank','scripts/import-math-bank.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for payload in ['<script>alert(1)</script>','<path onclick="alert(1)"/>','<image href="https://example.com/x"/>','<path fill="url(https://example.com)"/>']:
 try:m.safe_svg('<svg xmlns="http://www.w3.org/2000/svg">'+payload+'</svg>')
 except ValueError:continue
 raise Exception('unsafe SVG accepted')
print('SVG safety passed')`;
 assert.match(execFileSync('python3',['-c',program],{encoding:'utf8'}),/passed/);
});
