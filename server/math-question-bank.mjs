import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {mathTopic,MATH_TAXONOMY_VERSION} from './math-taxonomy.mjs';
import {parseMathAnswer} from './math-practice.mjs';

const bank=JSON.parse(readFileSync(new URL('../vendor/cn-math-taxonomy/questions-junior.json',import.meta.url),'utf8'));
if(bank.commit!==MATH_TAXONOMY_VERSION)throw new Error('题库与知识分类版本不一致');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const records=new Map();
for(const q of bank.questions){
  const {audit,...source}=q;
  if(records.has(q.id)||!mathTopic(q.topicId)||hash(source)!==audit.contentHash)throw new Error('题库校验失败：'+q.id);
  records.set(q.id,q);
}
export const bankSummary=Object.freeze({...bank.counts,source:bank.source,commit:bank.commit});
export const bankRecord=id=>records.get(id)||null;
export const bankTopicCount=topicId=>[...records.values()].filter(q=>q.topicId===topicId&&q.audit.status!=='quarantined').length;
const difficultyRank={basic:0,standard:1,advanced:2};
export function bankCandidates(topicId,{difficulty='basic',questionType='any',usedIds=[]}={}){
  const used=new Set(usedIds);
  return [...records.values()].filter(q=>q.topicId===topicId&&q.audit.status!=='quarantined'&&!used.has(q.id)&&(questionType==='any'||q.type===questionType))
    .sort((a,b)=>Math.abs(difficultyRank[a.difficulty]-difficultyRank[difficulty])-Math.abs(difficultyRank[b.difficulty]-difficultyRank[difficulty])||a.id.localeCompare(b.id));
}
export function bankFigure(id,part){
  const q=bankRecord(id);if(!q||q.audit.status==='quarantined')return null;
  return part==='question'?q.figure||null:q.choices?.find(c=>c.key===part)?.figure||null;
}
export function bankFigureRefs(q){
  const url=part=>`/api/math-bank/figures/${q.id}/${part}`;
  return [...(q.figure?[{url:url('question'),label:'题目配图'}]:[]),...(q.choices||[]).filter(c=>c.figure).map(c=>({url:url(c.key),label:`选项 ${c.key}`}))];
}
export function bankStem(q){
  return q.prompt+(q.choices?'\n\n'+q.choices.map(c=>`${c.key}. ${q.hideChoiceText?'见选项配图':c.text}`).join('\n'):'');
}
const clean=text=>String(text).trim().replace(/[。.!！]$/,'').replace(/^(?:我选|选择|选|我的答案是|答案是|答案为)\s*/,'').trim();
const shortKey=text=>clean(text).replace(/²/g,'^2').replace(/³/g,'^3').normalize('NFKC').replace(/−/g,'-').replace(/[\s*·]/g,'');
function vector(text){
  const parts=clean(text).split(/[,，、]/);if(parts.length>12)return null;
  const values=parts.map(parseMathAnswer);return values.every(v=>v!==null)?values:null;
}
export function compareBankAnswer(record,text){
  if(record.type==='choice'){
    let value=clean(text).toUpperCase().replace(/(?:选项|项)$/,'').trim();
    if(!record.choices.some(c=>c.key===value)){
      const exact=record.choices.filter(c=>c.text===String(text).trim());
      if(exact.length!==1)return {status:'needs_clarification'};value=exact[0].key;
    }
    return {status:'graded',correct:value===record.answer};
  }
  if(record.type==='numeric'){
    const values=vector(text),expected=vector(record.answer);
    if(!values||!expected||values.length!==expected.length)return {status:'needs_clarification'};
    if(record.unordered){values.sort((a,b)=>a-b);expected.sort((a,b)=>a-b);}
    return {status:'graded',correct:values.every((v,i)=>Math.abs(v-expected[i])<=1e-8)};
  }
  if(record.type==='short'){
    const accepted=[record.answer,...(record.accept||[])].map(shortKey);
    // Unlisted symbolic forms may be equivalent: do not mark them wrong.
    return accepted.includes(shortKey(text))?{status:'graded',correct:true}:{status:'needs_review'};
  }
  return {status:'needs_review'};
}
export function approvedBankReview(record,review){
  return review?.status==='model_checked'&&review.questionHash===record.audit.contentHash&&review.version===1
    &&(record.type==='self'?review.referenceConsistent===true:compareBankAnswer(record,review.answer).correct===true);
}
export function createBankPractice(record,review){
  if(record.audit.status==='quarantined'||!approvedBankReview(record,review))throw new Error('题目尚未通过出题前复核');
  const topic=mathTopic(record.topicId);
  return {id:randomUUID(),type:'math-bank',subject:'数学',topicId:record.topicId,topic:topic.name,skill:topic.name,grade:topic.grade,
    stem:bankStem(record),answer:record.answer,solution:review.reason,hints:[review.hint||'先圈出已知条件，确认题目要求，再选择相关的概念或关系。'],
    questionType:record.type,difficulty:record.difficulty,source:'cn-math-taxonomy 开放练习题库（AI 编写，非真题）',
    bankId:record.id,bankHash:record.audit.contentHash,bankReview:review,taxonomyVersion:bank.commit,
    sourceUrl:`${bank.source}/blob/${bank.commit}/data/questions.json`,practiceFigures:bankFigureRefs(record),
    reviewStatus:'结构检查及出题前模型复核通过；尚未经教师审核',assessmentScope:'题库单题作答，不能由一道题推断全部前置知识已掌握'};
}
export function checkBankAnswer(question,text){
  const record=bankRecord(question.bankId);
  if(!record||question.bankHash!==record.audit.contentHash||question.stem!==bankStem(record)||question.answer!==record.answer||!approvedBankReview(record,question.bankReview))return {status:'invalid_question'};
  return compareBankAnswer(record,text);
}
export function isBankAnswerInput(question,text){
  const q=bankRecord(question.bankId);if(!q)return false;
  const result=compareBankAnswer(q,text);return result.status==='graded';
}
export function bankPublicCandidates(topicId,options){
  return bankCandidates(topicId,options).slice(0,6).map(q=>({id:q.id,topicId:q.topicId,difficulty:q.difficulty,type:q.type,prompt:q.prompt,hasFigure:!!bankFigureRefs(q).length,status:q.audit.status}));
}
