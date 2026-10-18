export const DEFAULT_AGENT_NAME = '小直';

export function hasNickname(profile = {}) {
  return Boolean(profile.displayName?.trim() && (profile.displayName !== '同学' || profile.nicknameConfirmed));
}

export function welcomeMessage(profile = {}, agentName = DEFAULT_AGENT_NAME) {
  if (hasNickname(profile)) return `${profile.displayName}，你好呀！我是${agentName}，又见面啦。今天有什么想聊的？有不会的题也可以发给我，我们一起慢慢想明白。`;
  if (profile.nicknameAsked) return `你好呀，我是${agentName}！今天有什么想聊的？作业、错题或者好奇的问题，都可以发给我，我们一起想明白。`;
  return `你好呀，我是${agentName}，你的 AI 学习伙伴！很高兴认识你。\n\n你希望我怎么称呼你？告诉我一个喜欢的昵称就好，比如“叫我小禾”。\n\n也可以先问问题，或者把作业拍给我。我们一步一步来，不着急。`;
}

// Only a short, explicit introduction or a direct reply to the nickname question
// can change the profile. Homework and ordinary questions are never name fields.
export function nicknameFromMessage(text, allowBare = false) {
  const value = text.trim().replace(/[。！!，,～~]+$/u, '');
  const explicit = /^(?:你可以叫我|以后叫我|请叫我|称呼我|叫我|我叫|我的名字是|我的昵称是|昵称是|昵称叫)\s*[“"「]?([^\n“”"「」]+?)[”"」]?$/u.exec(value);
  const name = (explicit?.[1] || (allowBare ? value : '')).trim();
  if (!explicit && (/[讲说教聊问看学算求解读写给来想要]/u.test(name) || (/[\p{Script=Han}]/u.test(name) && [...name].length > 4))) return null;
  if (!name || [...name].length > 16 || !/^[\p{L}][\p{L}\p{N} ·-]*$/u.test(name)) return null;
  if (/\d{4,}/u.test(name) || /(?:你好|您好|不会|不懂|不知道|不想|不告诉|不用|不必|不要|先不|为什么|什么|怎么|如何|帮我|请问|我想|我要|我在|我有|我是|作业|错题|解题|做题|答案|吗|呢|可以|谢谢)/u.test(name)) return null;
  if (/^(?:好|好的|嗯|哦|是|不是|随便|算了|跳过|数学|语文|英语|物理|化学|历史|道法|道德与法治|同学|学生|hello|hi|ok)$/iu.test(name)) return null;
  return name;
}
