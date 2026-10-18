export const topics = ['二次函数', '方程与不等式', '几何与相似', '统计与概率'];
export const samples = [
  { id:'sample-1', skill:'二次函数：求对称轴', topic:topics[0], stem:'已知二次函数 y = x² − 4x + 3，求其图像的对称轴 x = __。', answer:2, hints:['先别急着计算。二次函数的对称轴是一条竖直直线。先找出式子中 x² 的系数 a 和 x 的系数 b，你能分别写出来吗？','一般式 y = ax² + bx + c 的对称轴为 x = −b ÷ (2a)。这里要特别注意 b 前面的负号。先把 a、b 代入，暂时不要心算。','代入后得到 x = −(−4) ÷ (2 × 1)。先算分子，再算分母，最后相除。你算出了多少？'], solution:'a = 1，b = −4，所以 x = −b/(2a) = 4/2 = 2。对称轴为直线 x = 2。也可以配方得到 y = (x − 2)² − 1。', type:'sample', source:'自编教学示例', template:'axis' },
  { id:'sample-2', skill:'一元一次方程：等式变形', topic:topics[1], stem:'解方程 3x + 5 = 20，x = __。', answer:5, hints:['等号两边像天平，要保持平衡。要让含 x 的项单独留下，先处理哪一项？','两边同时减去 5，得到 3x = 15。现在 x 还乘着几？','等号两边再同时除以 3。试着写出结果，再代回原方程核对。'], solution:'两边减去 5 得 3x = 15；再除以 3 得 x = 5。代入 3 × 5 + 5 = 20，等式成立。',type:'sample',source:'自编教学示例',template:'linear' },
  { id:'sample-3', skill:'相似三角形：对应边比例', topic:topics[2], stem:'两个相似三角形的相似比为 2∶3。小三角形的一条边长为 6，大三角形的对应边长为 __。',answer:9,hints:['先确认“对应边”。相似比描述的是对应边长度的比，不是面积比。这里哪一个数对应小三角形？','设大三角形对应边为 x。按同样顺序列比：6/x = 2/3。','交叉相乘得到 2x = 18。现在尝试求 x，并检查大三角形的边是否更长。'],solution:'设大三角形的对应边长为 x。6/x = 2/3，所以 2x = 18，x = 9。',type:'sample',source:'自编教学示例',template:'similar' },
  { id:'sample-4', skill:'等可能事件：计算概率', topic:topics[3],stem:'袋中有 3 个红球、2 个白球，它们除颜色外完全相同。随机摸出 1 个球，摸到红球的概率为 __（可填分数）。',answer:0.6,hints:['这些球被摸到的机会相同。先数一数所有可能结果，再数“摸到红球”的结果。','概率 = 符合条件的结果数 ÷ 所有等可能结果数。分母是所有球，不只是白球。','列出分数后，检查它是不是在 0 到 1 之间。试着把分数输入下面。'],solution:'共有 3 + 2 = 5 个球，红球有 3 个，所以 P(红球) = 3/5 = 0.6。',type:'sample',source:'自编教学示例',template:'probability' }
];
export function parseNumber(raw) {
  const s = String(raw).trim().replace(/−/g,'-').replace(/\s/g,'');
  if (/^-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?$/.test(s)) {const [a,b]=s.split('/').map(Number);return b ? a/b : NaN;}
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)%$/.test(s)) return Number(s.slice(0,-1))/100;
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s) ? Number(s) : NaN;
}
export function grade(question, raw) { const n=parseNumber(raw);return Number.isFinite(n) && Math.abs(n-Number(question.answer))<1e-8; }
export function variant(source, random = Math.random) {
  const n=()=>2+Math.floor(random()*7);const a=n(),b=n(),c=n();
  const q={...source,id:`generated-${crypto.randomUUID()}`,parentId:source.id,type:'generated',source:'参数模板变式 · 待与原题区分',hints:['先说一说这题和之前那题有什么相同，又有哪些数字变了？','根据已知条件列式。先写式子，再计算，最后代回检查。']};
  if(source.template==='axis'){q.stem=`二次函数 y = x² − ${2*a}x + ${b} 的对称轴为 x = __。`;q.answer=a;q.solution=`对称轴 x = −b/(2a) = ${2*a}/2 = ${a}。`;}
  else if(source.template==='linear'){q.stem=`解方程 ${a}x + ${b} = ${a*c+b}，x = __。`;q.answer=c;q.solution=`两边减去 ${b} 得 ${a}x = ${a*c}，再除以 ${a}，得 x = ${c}。`;}
  else if(source.template==='similar'){q.stem=`两个相似三角形的相似比为 2∶3，小三角形的一条边长为 ${2*a}，大三角形对应边长为 __。`;q.answer=3*a;q.solution=`对应边成比例，大三角形边长 = ${2*a} × 3/2 = ${3*a}。`;}
  else if(source.template==='probability'){q.stem=`袋中有 ${a} 个红球、${b} 个白球，除颜色外完全相同，随机摸出一个，摸到红球的概率为 __。`;q.answer=a/(a+b);q.solution=`P(红球) = ${a}/${a+b}。`;}
  else throw new Error('该题尚未建立参数模板，请通过老师讲解后再生成变式。');
  return q;
}
export function diagnostics(attempts, questions) {
  return topics.map(topic=>{const rows=attempts.filter(a=>questions.find(q=>q.id===a.questionId)?.topic===topic);return {topic,total:rows.length,correct:rows.filter(a=>a.correct).length,wrong:rows.filter(a=>!a.correct).length};});
}
export function speechText(text) { return String(text).replace(/```[\s\S]*?```/g,'').replace(/[#*`]/g,'').replace(/x²/g,'x 的平方').replace(/÷/g,'除以').replace(/×/g,'乘以').replace(/=/g,'等于').replace(/−/g,'减'); }
