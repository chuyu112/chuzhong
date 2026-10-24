export const VIDEO_SPEC = Object.freeze({ duration: 30, resolution: '480p', ratio: '16:9' });

// Explicit requests only: asking about a video or a historical topic is not consent to generate one.
export function wantsLearningVideo(text, media = '') {
  if (media === '视频') return true;
  const value = String(text).replace(/\s+/g, '');
  if (/(不要|不用|别|不需要).{0,10}(视频|短片)/.test(value)) return false;
  return /(?:生成|制作|做|来|给我|想看).{0,12}(?:视频|短片)|用视频.{0,8}(?:讲|解释|演示)|(?:视频|短片).{0,8}(?:讲一下|讲讲|解释一下)/.test(value);
}

export const VIDEO_DIRECTION = `【交付】Wan 3.0文生视频；单条30秒，16:9横屏，480p，中文画外旁白。以下栏目、时间码和文字仅是制作说明，不显示在画面中。
【真人影像】真人实拍电影质感：自然人类面孔、正常身体比例、可见但不过度锐化的皮肤纹理，衣料褶皱、金属和木石的真实材质。人物以克制的表情、视线和动作表达情绪，动作有重心、惯性与接触反馈。禁止二次元、动漫、卡通、赛璐璐、插画、漫画、游戏过场和塑料感CG人物。
【美术与连续性】严格执行本片人物、服装、时代、场景及道具设定。同一角色跨镜头不换脸换衣；不同人物保持可辨识的年龄和服饰。同一场景内部空间固定，用城门、桌沿等位置锚点说明站位和移动；故事换地点时明确切镜，不强行把不同事件放在一个场景。不穿墙、不瞬移、不凭空增减人物与关键道具。历史画面是演员演绎的再现，不冒充真实历史影像。
【摄影与光线】以中景呈现关系、近景强调关键动作，必要时用建立镜头交代环境；构图有清楚的视觉重点、前中后景与空间层次。使用符合场景的日光、窗光或灯火，光源方向一致，保留暗部与肤色层次。浅景深只用于突出主体，解释关系时让关键对象同时清晰。不用过强虚化、过曝、眩光或滤镜遮挡知识点。自然低饱和调色，镜头之间色温和质感连续。
【运镜与剪辑】每段围绕一项清楚的主要动作，镜头运动有目的、速度平稳。固定、推近或平移选择其一，不同时要求固定与环绕。按动作衔接或叙事顺序自然切镜，保持人物视线和运动方向；换时空用明确切镜，不用人物变形或建筑融化转场。结尾留停顿，不突然截断。
【声音】单一、清晰自然的普通话画外旁白，温和沉稳、吐字清楚，逐字读指定旁白；语义与同时间段画面对应，给停顿和理解留时间。人物不额外开口、不增添对白，不强求口型同步。环境声低于人声，无背景音乐、无夸张音效。
【画面文字】全片无字幕、无标题字卡、无姓名标签、无年份数字、无片头片尾文字、无可辨识招牌或公式板，不将旁白转成字幕。年份、姓名、术语及必要公式只用声音交代。
【成片底线】知识事实、人物身份、物理关系和事件次序准确。无肢体畸形、额外手指、物体穿模、脸部闪变、画面闪烁、无意义空镜或静止图片轮播。历史冲突克制呈现，不渲染血腥。`;

export const VIDEO_PROMPT_POLICY = `本轮学生明确要求用视频理解知识点。你兼任教育编剧、真人短片导演与分镜设计师。先用简短文字讲清本轮内容，正文不要展示制作提示词、技术参数或声称视频已经完成。
设计流程：先提炼学生真正不理解的一点，用一句goal定义看完应懂什么；再整理已知facts；再写三段形成因果关系的旁白；最后设计能解释旁白的真人动作与场景，检查连续性。镜头服务理解，不用景物、战争大场面或表情特写填满时长。只写已知知识事实，不把“核对”当作已经检索过资料，不自行编造史实。
叙事必须完整：0—10秒建立背景或具体疑问；10—20秒演示核心事件、机制或转折；20—30秒交代结果、影响或解释为什么。历史故事包含背景、主要人物、关键事件和后果；英语用真人生活情境呈现语义与动作先后，必要例句可用英语配音；数学、科学用真人操作实物体现关键数量、位置和变化，不为电影效果牺牲准确性。
${VIDEO_DIRECTION}
在回复末尾附且仅附一个隐藏标记 <learning-video>{"title":"知识点标题","goal":"一个明确学习目标","facts":["关键事实或准确条件"],"continuity":"本片人物身份、外貌服装、时代地点、场景空间锚点、关键道具、统一光线色调，须具体到本题。","scenes":[{"seconds":10,"purpose":"这一段让学生理解什么","start":"开始时谁在哪里、在做什么","visual":"谁通过什么具体动作，造成什么可见变化","camera":"景别、视角、一种运镜、视觉焦点","end":"结束状态与下一段的衔接","sound":"与本段动作相符的低音量环境声","narration":"这段中文旁白"},{"seconds":10,"purpose":"核心事件或机制","start":"起始状态","visual":"具体动作和可见变化","camera":"镜头","end":"结束状态与衔接","sound":"环境声","narration":"旁白"},{"seconds":10,"purpose":"结果和理解","start":"起始状态","visual":"具体动作和可见变化","camera":"镜头","end":"结尾停顿的状态","sound":"环境声","narration":"旁白"}]}</learning-video>，不要用代码围栏。
字段预算：goal不超过120字；facts为1—4条，每条不超过120字；continuity不超过240字。每个purpose不超过50字，start和end各不超过80字，visual不超过180字，camera不超过90字，sound不超过50字。三段各10秒，每段旁白28—42字，含标点绝不超过45字，全片不超过130字；按真实口语速度留停顿，不加速硬塞内容。完整成片提示词不超过3000字，删去重复修饰，保留事实和动作。
每段起始状态必须与上一段结束相容；不同时间地点明确切换，不把多个历史人物合成一人。旁白转到新人物或新事件时，画面也要呈现对应主体与事件，不可一直拍上一事件的队伍、背影或空景来暗示新事件。continuity要覆盖三段所需的不同人物与地点，不能把整个故事锁在一个城门或房间里。角色姓名和制作标签不显示在画面。文生视频没有参考素材，不编造“图1”或“视频1”；可设计示意性的环境细节，但不得说成史料记载或人物真实容貌。每段旁白与动作对齐，最后一句回应goal，不以一句“要不要再试试”代替知识结论。
保持当前教学进度，作业尚未尝试的部分不在旁白或画面中泄露最终答案。不要包含孩子的姓名、账号、学校、家庭情况或聊天原文。历史内容分清年份、人物、原因与影响，不编造人物原话，不把再现场景当成真实历史影像；不自行添加新都、边界或地名，不画地图、疆域或河流位置。数学图形、方向、数量必须一致。若关键事实不明或题目看不清，先澄清，不输出视频标记。
输出前自检：三段恰好30秒、叙事有因果而非片段罗列；人物场景一致；主要动作在10秒内可完成；旁白能说完且与画面对应；无字幕、无二次元、无赛璐璐；与facts和教学范围一致。`;

function cleanString(value, max, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) throw new Error('视频说明格式不完整');
  return value.trim();
}

export function validateVideoBrief(value) {
  if (!value || !Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 4 || !Array.isArray(value.scenes) || value.scenes.length !== 3) throw new Error('视频需要三个清楚的分镜');
  const brief = {
    title: cleanString(value.title, 60), goal: cleanString(value.goal, 120),
    facts: value.facts.map(fact => cleanString(fact, 120)),
    continuity: cleanString(value.continuity, 240),
    scenes: value.scenes.map(scene => {
      if (scene.seconds !== 10) throw new Error('视频时长需要合计30秒');
      if (typeof scene.narration !== 'string' || scene.narration.trim().length < 28) throw new Error('每段旁白需要28—45字，以完整讲清内容');
      return { seconds: 10, purpose: cleanString(scene.purpose, 50), start: cleanString(scene.start, 80), visual: cleanString(scene.visual, 180), camera: cleanString(scene.camera, 90), end: cleanString(scene.end, 80), sound: cleanString(scene.sound, 50), narration: cleanString(scene.narration, 45) };
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
    VIDEO_DIRECTION,
    `【本片主题】${brief.title}\n【学习目标】${brief.goal}\n【必须准确的事实】\n${brief.facts.map(f => '- ' + f).join('\n')}\n【人物与场景统一设定】${brief.continuity}`,
    ...brief.scenes.map((s, i) => `【${i * 10}—${(i + 1) * 10}秒】\n本段要说明：${s.purpose}\n起始状态：${s.start}\n动作与变化：${s.visual}\n摄影：${s.camera}\n结束与衔接：${s.end}\n环境声：${s.sound}\n画外旁白（逐字使用）：“${s.narration}”`),
    '仅生成这一条完整短片，不添加新事件、对白、结论或版本。人物场景按设定连续，时间顺序清楚。真人实拍电影质感，全程无字幕和任何画面文字。',
  ].join('\n\n');
  if (prompt.length > 3000) throw new Error('视频提示词超过Wan 3.0长度限制');
  return prompt;
}
