export const VIDEO_SPEC = Object.freeze({ duration: 30, resolution: '480p', ratio: '16:9' });

// Explicit requests only: asking about a video or a historical topic is not consent to generate one.
export function wantsLearningVideo(text, media = '') {
  if (media === '视频') return true;
  const value = String(text).replace(/\s+/g, '');
  if (/(不要|不用|别|不需要).{0,10}(视频|短片)/.test(value)) return false;
  return /(?:生成|制作|做|来|给我|想看).{0,12}(?:视频|短片)|用视频.{0,8}(?:讲|解释|演示)|(?:视频|短片).{0,8}(?:讲一下|讲讲|解释一下)/.test(value);
}

export const VIDEO_PROMPT_POLICY = `本轮学生明确要求用视频理解知识点。先用简短文字讲清本轮内容，正文不要展示制作提示词、技术参数或声称视频已经完成。
在回复末尾附且仅附一个隐藏标记 <learning-video>{"title":"知识点标题","goal":"本片要让学生理解的一件事","facts":["关键事实或准确条件"],"scenes":[{"seconds":10,"visual":"画面及连续变化","camera":"镜头运动","narration":"这段中文旁白","label":"可选的短标签"},{"seconds":10,"visual":"第二段画面","camera":"镜头运动","narration":"中文旁白","label":"短标签"},{"seconds":10,"visual":"最后一段画面","camera":"镜头运动","narration":"中文旁白","label":"短标签"}]}</learning-video>，不要用代码围栏。
文生视频，横屏16:9，480p，总长30秒；三段各10秒。每段旁白28—42字，含标点绝不超过45字，全片不超过130字，语速自然，留出理解和停顿时间。内容过多时删去次要事实，不加快语速。每段画面必须实际解释一个事实、关系或变化，不能只写漂亮画面或把长段文字贴在屏幕上。最后用一句话收束学习目标，可留一个简短思考问题。历史事件默认用时间线、人物关系和场景插画，不画地图、疆域或河流位置；不要自行添加新都、边界和地名，呈现地点与facts中的事实严格一致。
根据当前问题与已经给出的讲解来整理，保持教学进度；作业尚未尝试的部分不在旁白、画面或标签中泄露最终答案。普通知识问题可充分讲清事实。历史内容分清年份、人物、原因与影响，不把不同事件混在一起，不编造人物原话和细节，不把示意画面当成历史影像；历史战争用地图、时间线和克制的插画表现。数学图形、公式、方向和数量必须一致。不要包含孩子的姓名、账号、学校、家庭情况或聊天原文。信息不足或题目看不清时先向孩子澄清，不输出视频标记。`;

function cleanString(value, max, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) throw new Error('视频说明格式不完整');
  return value.trim();
}

export function validateVideoBrief(value) {
  if (!value || !Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 6 || !Array.isArray(value.scenes) || value.scenes.length !== 3) throw new Error('视频需要三个清楚的分镜');
  const brief = {
    title: cleanString(value.title, 60), goal: cleanString(value.goal, 300),
    facts: value.facts.map(fact => cleanString(fact, 500)),
    scenes: value.scenes.map(scene => {
      if (scene.seconds !== 10) throw new Error('视频时长需要合计30秒');
      return { seconds: 10, visual: cleanString(scene.visual, 700), camera: cleanString(scene.camera, 200), narration: cleanString(scene.narration, 45), label: cleanString(scene.label, 30, true) };
    }),
  };
  if (brief.scenes.map(s => s.narration).join('').length > 130) throw new Error('视频旁白太长');
  return brief;
}

export function extractVideoBrief(raw) {
  const matches = [...String(raw).matchAll(/<learning-video>([\s\S]*?)<\/learning-video>/gi)];
  let brief = null;
  if (matches.length === 1 && matches[0][1].length < 14000) {
    try { brief = validateVideoBrief(JSON.parse(matches[0][1])); } catch { /* Never submit incomplete model metadata. */ }
  }
  return { brief, text: String(raw).replace(/<learning-video>[\s\S]*?(?:<\/learning-video>|$)/gi, '').trim() };
}

export function buildVideoPrompt(input) {
  const brief = validateVideoBrief(input);
  return [
    '生成一条完整的30秒教育讲解视频，文生视频，16:9横屏，480p，中文自然旁白与画面同步。只生成一条，不生成其它版本。',
    '适合初中生观看，清晰的教育插画和动态示意，画面连续，事实准确。低音量环境音，不添加抢旁白的音乐。标签少而清晰，不把制作要求写进画面。',
    `主题：${brief.title}\n学习目标：${brief.goal}\n必须保持准确的事实：\n${brief.facts.map(f => '- ' + f).join('\n')}`,
    ...brief.scenes.map((s, i) => `${i * 10}—${(i + 1) * 10}秒：\n画面：${s.visual}\n镜头：${s.camera}\n旁白（逐字使用）：${s.narration}\n短标签：${s.label || '无'}`),
    '历史场景为教学示意，不冒充真实历史影像；不添加未经说明的人物台词或史实。保持给出的公式、数字、事件次序和教学范围。',
  ].join('\n\n');
}
