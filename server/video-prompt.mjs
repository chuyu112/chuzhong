export const VIDEO_SPEC = Object.freeze({ duration: 30, resolution: '480p', ratio: '16:9' });

// Explicit requests only: asking about a video or a historical topic is not consent to generate one.
export function wantsLearningVideo(text, media = '') {
  if (media === '视频') return true;
  const value = String(text).replace(/\s+/g, '');
  if (/(不要|不用|别|不需要).{0,10}(视频|短片)/.test(value)) return false;
  return /(?:生成|制作|做|来|给我|想看).{0,12}(?:视频|短片)|用视频.{0,8}(?:讲|解释|演示)|(?:视频|短片).{0,8}(?:讲一下|讲讲|解释一下)/.test(value);
}

export const VIDEO_PROMPT_POLICY = `本轮学生明确要求用视频理解知识点。先用简短文字讲清本轮内容，正文不要展示制作提示词、技术参数或声称视频已经完成。
在回复末尾附且仅附一个隐藏标记 <learning-video>{"title":"知识点标题","goal":"本片要让学生理解的一件事","facts":["关键事实或准确条件"],"scenes":[{"seconds":10,"visual":"真人场景及连续动作","camera":"镜头运动","narration":"这段中文旁白"},{"seconds":10,"visual":"第二段真人场景","camera":"镜头运动","narration":"中文旁白"},{"seconds":10,"visual":"最后一段真人场景","camera":"镜头运动","narration":"中文旁白"}]}</learning-video>，不要用代码围栏。
文生视频，横屏16:9，480p，总长30秒；三段各10秒。每段旁白28—42字，含标点绝不超过45字，全片不超过130字，语速自然，留出理解和停顿时间。内容过多时删去次要事实，不加快语速。每段visual不超过300字，camera不超过100字，事实最多6条且每条不超过200字。
视觉风格固定为真人实拍电影质感，使用真实人类的自然面孔、皮肤纹理、符合年龄的比例、真实服饰、实物场景及自然光影。绝不使用二次元、动漫、卡通、赛璐璐、插画、漫画或动画渲染。历史人物用演员演绎的再现场景，服饰、建筑和道具符合时代，三段中同一角色的外貌服装与空间关系保持一致；数学和科学用真人操作实物的直观演示。叙事必须完整：第一段建立背景与原因，第二段呈现核心事件或机制，第三段交代结果与影响，让学生30秒听懂来龙去脉。采用电影级构图、景别变化、自然运镜和场景细节，镜头服务叙事，不堆砌空镜。每段画面必须通过动作、实物或因果变化解释一个知识点，不能只写漂亮画面。
全片无字幕、无标题字卡、无人物姓名标签、无年份数字、无片头片尾文字、无可辨识招牌或书写文字。不把旁白写到屏幕上；画面中也不出现文字时间线、地图标签或公式板。年份、姓名、术语和必要公式只通过中文旁白交代。旁白是画外音，不要求人物对口型，不能被转成画面字幕。最后用一句旁白收束学习目标，可留一个简短思考问题。
根据当前问题与已经给出的讲解来整理，保持教学进度；作业尚未尝试的部分不在旁白或画面中泄露最终答案。普通知识问题可充分讲清事实。历史内容分清年份、人物、原因与影响，不把不同事件混在一起，不编造人物原话和细节，不把再现场景当成真实历史影像；战争以克制的真人场景表现，不渲染血腥。不要自行添加新都、边界和地名，不画地图或河流位置，呈现地点与facts严格一致。数学图形、方向和数量必须一致。不要包含孩子的姓名、账号、学校、家庭情况或聊天原文。信息不足或题目看不清时先向孩子澄清，不输出视频标记。`;

function cleanString(value, max, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) throw new Error('视频说明格式不完整');
  return value.trim();
}

export function validateVideoBrief(value) {
  if (!value || !Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 6 || !Array.isArray(value.scenes) || value.scenes.length !== 3) throw new Error('视频需要三个清楚的分镜');
  const brief = {
    title: cleanString(value.title, 60), goal: cleanString(value.goal, 300),
    facts: value.facts.map(fact => cleanString(fact, 200)),
    scenes: value.scenes.map(scene => {
      if (scene.seconds !== 10) throw new Error('视频时长需要合计30秒');
      return { seconds: 10, visual: cleanString(scene.visual, 300), camera: cleanString(scene.camera, 100), narration: cleanString(scene.narration, 45) };
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
  const prompt = [
    '生成一条完整的30秒教育讲解视频，文生视频，16:9横屏，480p，中文自然旁白与画面同步。只生成一条，不生成其它版本。',
    '固定视觉：真人实拍电影质感，真实人类的自然面孔、皮肤纹理、正常人体比例、真实服饰和实物场景，自然光影。以真人行动及实物变化解释知识。禁止二次元、动漫、卡通、赛璐璐、插画、漫画及动画渲染。同一人物跨镜头保持外貌与服饰一致，动作和空间关系连续。低音量环境音，不添加抢旁白的音乐。',
    '全片无字幕、无标题字卡、无姓名标签、无年份数字、无片头片尾文字、无可辨识文字或公式板。旁白仅是中文画外音，绝不将旁白或制作提示写进画面。以下主题、事实和时间段仅用于制作理解，不显示在视频上。',
    `主题：${brief.title}\n学习目标：${brief.goal}\n必须保持准确的事实：\n${brief.facts.map(f => '- ' + f).join('\n')}`,
    ...brief.scenes.map((s, i) => `${i * 10}—${(i + 1) * 10}秒：\n画面：${s.visual}\n镜头：${s.camera}\n旁白（逐字使用）：${s.narration}`),
    '历史场景为真人演员再现，服饰、建筑、道具符合时代，不冒充真实历史影像；不添加未经说明的人物台词或史实。保持给出的事实、事件次序和教学范围。再次确认：真人实拍质感，无二次元、无赛璐璐，全程无字幕及任何画面文字。',
  ].join('\n\n');
  if (prompt.length > 3000) throw new Error('视频提示词超过Wan 3.0长度限制');
  return prompt;
}
