import { randomInt, randomUUID, createHash } from 'node:crypto';
import { mathTopic, MATH_TAXONOMY_VERSION } from './math-taxonomy.mjs';

// Reviewed, parameterized numeric exercises. Taxonomy membership alone never
// means a generated question or an answer has been verified.
const families = {
  addition: ['cnm_010'], subtraction: ['cnm_012'], multiplication: ['cnm_014'],
  linear: ['cnm_042'], brackets: ['cnm_043'], denominator: ['cnm_044'],
  squareRoot: ['cnm_074', 'cnm_075'], cubeRoot: ['cnm_076'],
  pythagoras: ['cnm_174'], slope: ['cnm_205'], inverse: ['cnm_240'],
  axis: ['cnm_232'], minimum: ['cnm_235'],
  mean: ['cnm_211'], weightedMean: ['cnm_212'], median: ['cnm_213'],
  probability: ['cnm_285'], enumerate: ['cnm_286'], similar: ['cnm_272'],
};
export const practiceTopicIds = Object.values(families).flat();
export const supportsMathPractice = id => practiceTopicIds.includes(id);
const skills={addition:'有理数加法',subtraction:'有理数减法',multiplication:'有理数乘法',linear:'移项求一元一次方程的解',brackets:'含括号的一元一次方程求解',denominator:'含常数分母的一元一次方程求解',squareRoot:'算术平方根求值',cubeRoot:'立方根求值',pythagoras:'已知两直角边求斜边',slope:'由两点求一次函数的斜率',inverse:'由一点求反比例系数',axis:'由一般式求抛物线对称轴',minimum:'求开口向上二次函数的最小值',mean:'平均数计算',weightedMean:'加权平均数计算',median:'五个数的中位数',probability:'单次摸球概率',enumerate:'两枚骰子点数和的概率',similar:'根据相似三角形的对应边求边长'};
const stemHash=stem=>createHash('sha256').update(stem).digest('hex');
const signed = n => n < 0 ? `−${-n}` : `+${n}`;
const paren = n => n < 0 ? `(${n})` : `${n}`;
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 1e-8;

function draft(family, int) {
  const x = int(-8, 9), a = int(2, 7), b = int(1, 10);
  let stem, answer, hint, params;
  if (['addition', 'subtraction', 'multiplication'].includes(family)) {
    const y = int(-9, 10);
    stem = `计算 ${paren(x)} ${ {addition:'+',subtraction:'−',multiplication:'×'}[family]} ${paren(y)}。`;
    answer = family==='addition'?x+y:family==='subtraction'?x-y:x*y;
    hint = '先判断符号，再计算绝对值。'; params={x,y};
  } else if (['linear','brackets','denominator'].includes(family)) {
    const c = family==='brackets'?a*(x+b):family==='denominator'?x+a*b:a*x+b;
    stem = family==='linear'?`解方程：${a}x+${b}=${c}。`:family==='brackets'?`解方程：${a}(x+${b})=${c}。`:`解方程：x/${a}+${b}=${c}/${a}。`;
    answer=x; hint='等式两边做同样的运算，先消去加减项，再考虑系数。'; params={a,b,c};
  } else if (family==='squareRoot' || family==='cubeRoot') {
    const base=family==='squareRoot'?b:x, power=family==='squareRoot'?2:3;
    const n=base**power;stem=family==='squareRoot'?`${n} 的算术平方根是多少？`:`${n} 的立方根是多少？`;
    answer=base;hint=family==='squareRoot'?'想一想哪个非负数的平方等于它。':'寻找立方后等于原数的数，注意符号。';params={n,power};
  } else if (family==='pythagoras') {
    const m=int(2,6), n=int(1,m), scale=int(1,4), u=(m*m-n*n)*scale, v=2*m*n*scale;
    stem=`直角三角形的两条直角边分别为 ${u} cm 和 ${v} cm，斜边长多少 cm？`;
    answer=(m*m+n*n)*scale;hint='先认清斜边；两条直角边的平方和等于斜边的平方。';params={u,v};
  } else if (family==='slope') {
    const k=int(1,6), x1=x, x2=x+a, y1=k*x1+b, y2=k*x2+b;
    stem=`一次函数 y=kx+b 的图象经过 (${x1}, ${y1}) 和 (${x2}, ${y2})，求 k。`;
    answer=k;hint='将两个点分别代入，比较两个等式，消去常数项。';params={x1,x2,y1,y2};
  } else if (family==='inverse') {
    const u=a,v=x||b;stem=`反比例函数 y=k/x 的图象经过 (${u}, ${v})，求 k。`;
    answer=u*v;hint='把点的横坐标和纵坐标同时代入关系式，注意 x 不为零。';params={u,v};
  } else if (family==='axis' || family==='minimum') {
    const h=x,k=int(-9,10), B=-2*a*h,C=a*h*h+k;
    stem=family==='axis'?`抛物线 y=${a}x²${signed(B)}x${signed(C)} 的对称轴是 x=多少？`:`二次函数 y=${a}x²${signed(B)}x${signed(C)} 的最小值是多少？`;
    answer=family==='axis'?h:k;hint='可以配方为顶点式，留意平方项的系数和顶点的位置。';params={a,B,C};
  } else if (['mean','median','weightedMean'].includes(family)) {
    const values=Array.from({length:5},()=>int(1,21)), weights=[1,2,3,2,2];
    stem=family==='weightedMean'?`5 项成绩为 ${values.join('、')}，对应权重为 ${weights.join('、')}，加权平均数是多少？`:`数据 ${values.join('、')} 的${family==='mean'?'平均数':'中位数'}是多少？`;
    answer=family==='median'?[...values].sort((a,b)=>a-b)[2]:family==='mean'?values.reduce((a,b)=>a+b,0)/5:values.reduce((sum,v,i)=>sum+v*weights[i],0)/10;
    hint=family==='median'?'先把数据按大小排列，再看中间位置。':family==='mean'?'总和除以数据个数。':'每个数先乘对应权重，再除以权重总和。';params={values,weights};
  } else if (family==='probability') {
    const red=a,blue=b;stem=`袋中有 ${red} 个红球和 ${blue} 个蓝球，除颜色外完全相同。充分混匀后随机摸出一个球，摸到红球的概率是多少？可以用分数回答。`;
    answer=red/(red+blue);hint='找出所有等可能结果的个数，以及其中符合要求的结果数。';params={red,blue};
  } else if (family==='enumerate') {
    const target=int(3,12);stem=`同时掷两枚均匀的六面骰子，点数之和为 ${target} 的概率是多少？可以用分数回答。`;
    const count=target<=7?target-1:13-target;answer=count/36;hint='用有序数对列出两枚骰子的所有结果，注意 (1,2) 和 (2,1) 不同。';params={target};
  } else if (family==='similar') {
    const u=a,v=a+b,w=int(2,12);stem=`△ABC∽△DEF，A、B、C 分别对应 D、E、F。AB=${u}，DE=${v}，AC=${w}，求 DF。可用分数回答。`;
    answer=w*v/u;hint='先找对应边；同一个三角形到另一个三角形的比例要保持一致。';params={u,v,w};
  }
  return {stem,answer,hints:[hint],params,family};
}

export function verifyMathPractice(q) {
  const p=q.validation?.parameters, family=q.validation?.family;
  if (!p || !families[family]?.includes(q.topicId) || typeof q.stem!=='string' || q.validation.stemHash!==stemHash(q.stem)) return false;
  let expected;
  if(family==='addition')expected=p.x+p.y;
  if(family==='subtraction')expected=p.x-p.y;
  if(family==='multiplication')expected=p.x*p.y;
  if(['linear','brackets','denominator'].includes(family)){
    // Enumerate the bounded integral domain independently of the chosen answer.
    const roots=Array.from({length:201},(_,i)=>i-100).filter(x=>near(family==='linear'?p.a*x+p.b:family==='brackets'?p.a*(x+p.b):x/p.a+p.b,family==='denominator'?p.c/p.a:p.c));
    if(roots.length!==1)return false;expected=roots[0];
  }
  if(family==='squareRoot')expected=Math.sqrt(p.n);
  if(family==='cubeRoot')expected=Math.cbrt(p.n);
  if(family==='pythagoras')expected=Math.hypot(p.u,p.v);
  if(family==='slope')expected=(p.y2-p.y1)/(p.x2-p.x1);
  if(family==='inverse')expected=p.u*p.v;
  if(family==='axis'){
    expected=-p.B/(2*p.a);
    for(const offset of [1,2,7])if(!near(p.a*(expected-offset)**2+p.B*(expected-offset)+p.C,p.a*(expected+offset)**2+p.B*(expected+offset)+p.C))return false;
  }
  if(family==='minimum'){
    if(!(p.a>0))return false;
    const vals=Array.from({length:81},(_,i)=>{const x=(i-40)/2;return p.a*x*x+p.B*x+p.C;});expected=Math.min(...vals);
  }
  if(family==='mean')expected=p.values.reduce((s,v)=>s+v,0)/p.values.length;
  if(family==='weightedMean'){
    const expanded=p.values.flatMap((v,i)=>Array(p.weights[i]).fill(v));expected=expanded.reduce((s,v)=>s+v,0)/expanded.length;
  }
  if(family==='median'){
    const values=p.values;expected=values.find(v=>values.filter(x=>x<=v).length>=3 && values.filter(x=>x>=v).length>=3);
  }
  if(family==='probability')expected=Array(p.red).fill(1).concat(Array(p.blue).fill(0)).reduce((s,v)=>s+v,0)/(p.red+p.blue);
  if(family==='enumerate'){
    let favorable=0;for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)if(a+b===p.target)favorable++;expected=favorable/36;
  }
  if(family==='similar')expected=p.w/(p.u/p.v);
  return typeof q.stem==='string' && !!q.stem && near(expected,q.answer);
}

export function createMathPractice(topicId, { int=randomInt, previousStems=[] }={}) {
  const family=Object.keys(families).find(key=>families[key].includes(topicId));
  if(!family)throw new Error('这个知识点暂没有经过校验的自动出题模板。');
  for(let i=0;i<50;i++){
    const d=draft(family,int),topic=mathTopic(topicId);
    const q={id:randomUUID(),subject:'数学',topicId,topic:topic.name,skill:skills[family],grade:topic.grade,source:'系统自编练习（非真题）',type:'math-practice',stem:d.stem,answer:d.answer,hints:d.hints,solution:`核对结果：${d.answer}。${d.hints[0]}`,taxonomyVersion:MATH_TAXONOMY_VERSION,validation:{family,parameters:d.params,stemHash:stemHash(d.stem),version:1},reviewStatus:'参数模板与数值答案已程序校验；不代表完整知识点掌握测评'};
    if(!verifyMathPractice(q))throw new Error('练习未通过校验，未发布。');
    if(!previousStems.includes(q.stem))return q;
  }
  throw new Error('暂时未找到不重复的题目，请换一个知识点。');
}

// Deliberately narrow: never evaluate arbitrary expressions or mistake a full
// explanation, multiple choices, or a question for a submitted numeric answer.
export function parseMathAnswer(input) {
  let s=String(input).trim().replace(/[。.!！]$/,'').replace(/−/g,'-');
  s=s.replace(/^(?:我算出(?:来)?|我的答案是|答案是|答案为|等于)\s*/,'').replace(/^[xykab]\s*[=＝]\s*/i,'').trim();
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+))?$/.test(s))return null;
  const parts=s.split('/').map(Number),value=parts.length===2?parts[0]/parts[1]:parts[0];
  return Number.isFinite(value)?value:null;
}

export function checkMathAnswer(q, input) {
  if(!verifyMathPractice(q))return {status:'invalid_question'};
  const value=parseMathAnswer(input);
  if(value===null)return {status:'needs_clarification'};
  return {status:'graded',correct:near(value,q.answer)};
}

export function publicMathPractice({answer,solution,hints,validation,bankReview,...q}) {
  return {...q,hintCount:hints?.length||0};
}

export function mathAnswerVerification(q) {
  if(!verifyMathPractice(q))return '';
  const p=q.validation.parameters,x=q.answer;
  if(q.validation.family==='linear')return `代入原式核验：${p.a}×(${x})+${p.b}=${p.c}，左右两边相等。`;
  if(q.validation.family==='brackets')return `代入原式核验：${p.a}×(${x}+${p.b})=${p.c}，左右两边相等。`;
  if(q.validation.family==='denominator')return `代入原式核验：(${x})/${p.a}+${p.b}=${p.c}/${p.a}，左右两边相等。`;
  if(q.validation.family==='pythagoras')return `核验：${p.u}²+${p.v}²=${x}²，符合直角三角形的勾股关系。`;
  return '题目中的条件和这个数值已核对一致。';
}
