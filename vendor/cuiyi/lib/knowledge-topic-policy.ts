export const XIAOJIE_KNOWLEDGE_BASE_ID = "xiaojie" as const;
export const XIAOJIE_KNOWLEDGE_BASE_NAME = "小洁知识库" as const;
export const KNOWLEDGE_TOPIC_POLICY_SCHEMA_VERSION = 2 as const;

export const XIAOJIE_KNOWLEDGE_TOPICS = Object.freeze([
  { topicId: "jade", name: "翡翠知识", enabled: true },
  { topicId: "resale", name: "回流知识", enabled: true },
  { topicId: "live-room", name: "直播间知识", enabled: false },
] as const);

export type XiaojieKnowledgeTopicId = typeof XIAOJIE_KNOWLEDGE_TOPICS[number]["topicId"];

export type KnowledgeTopicSwitch = {
  topicId: XiaojieKnowledgeTopicId;
  name: string;
  enabled: boolean;
  updatedBy?: string | null;
  updatedAt?: string;
};

export type KnowledgeTopicPolicySnapshot = {
  schemaVersion: typeof KNOWLEDGE_TOPIC_POLICY_SCHEMA_VERSION;
  knowledgeBaseId: typeof XIAOJIE_KNOWLEDGE_BASE_ID;
  knowledgeBaseName: typeof XIAOJIE_KNOWLEDGE_BASE_NAME;
  topics: KnowledgeTopicSwitch[];
};

const topicById = new Map<XiaojieKnowledgeTopicId, typeof XIAOJIE_KNOWLEDGE_TOPICS[number]>(
  XIAOJIE_KNOWLEDGE_TOPICS.map((topic) => [topic.topicId, topic]),
);

const legacyTopicIds = new Map<string, XiaojieKnowledgeTopicId>([
  ["jade", "jade"],
  ["翡翠", "jade"],
  ["翡翠知识", "jade"],
  ["knowledge-keyword-jade", "jade"],
  ["resale", "resale"],
  ["回流", "resale"],
  ["回流知识", "resale"],
  ["knowledge-keyword-resale", "resale"],
  ["live-room", "live-room"],
  ["直播间", "live-room"],
  ["直播间知识", "live-room"],
  ["knowledge-keyword-live-room", "live-room"],
]);

function normalizedIdentifier(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKC").replaceAll(String.fromCharCode(0), "").trim().toLocaleLowerCase("zh-CN")
    : "";
}

export function normalizeKnowledgeTopicId(value: unknown): XiaojieKnowledgeTopicId | null {
  return legacyTopicIds.get(normalizedIdentifier(value)) || null;
}

export function isKnowledgeTopicId(value: unknown): value is XiaojieKnowledgeTopicId {
  const normalized = normalizeKnowledgeTopicId(value);
  return Boolean(normalized && normalized === value);
}

export function normalizeKnowledgeTopicSwitches(value: unknown): KnowledgeTopicSwitch[] {
  const configured = new Map<XiaojieKnowledgeTopicId, KnowledgeTopicSwitch>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const topicId = normalizeKnowledgeTopicId(
        record.topicId || record.id || record.normalizedKeyword || record.keyword || record.name,
      );
      if (!topicId || typeof record.enabled !== "boolean") continue;
      const canonical = topicById.get(topicId)!;
      configured.set(topicId, {
        topicId,
        name: canonical.name,
        enabled: record.enabled,
        ...(typeof record.updatedBy === "string" || record.updatedBy === null
          ? { updatedBy: record.updatedBy as string | null }
          : {}),
        ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
      });
    }
  }
  return XIAOJIE_KNOWLEDGE_TOPICS.map((canonical) => configured.get(canonical.topicId) || {
    topicId: canonical.topicId,
    name: canonical.name,
    enabled: canonical.enabled,
  });
}

export function createKnowledgeTopicPolicySnapshot(topics: unknown): KnowledgeTopicPolicySnapshot {
  return {
    schemaVersion: KNOWLEDGE_TOPIC_POLICY_SCHEMA_VERSION,
    knowledgeBaseId: XIAOJIE_KNOWLEDGE_BASE_ID,
    knowledgeBaseName: XIAOJIE_KNOWLEDGE_BASE_NAME,
    topics: normalizeKnowledgeTopicSwitches(topics),
  };
}

export function parseKnowledgeTopicPolicySnapshot(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return createKnowledgeTopicPolicySnapshot([]);
  }
  const record = parsed as Record<string, unknown>;
  return createKnowledgeTopicPolicySnapshot(record.topics || record.switches);
}

export function evaluateKnowledgeTopicPolicy(topics: unknown) {
  const normalizedTopics = normalizeKnowledgeTopicSwitches(topics);
  const enabledTopicIds = normalizedTopics
    .filter((topic) => topic.enabled)
    .map((topic) => topic.topicId);
  const disabledTopicIds = normalizedTopics
    .filter((topic) => !topic.enabled)
    .map((topic) => topic.topicId);
  return {
    allowed: enabledTopicIds.length > 0,
    reason: enabledTopicIds.length > 0 ? "enabled-topics" : "all-topics-disabled",
    knowledgeBaseId: XIAOJIE_KNOWLEDGE_BASE_ID,
    enabledTopicIds,
    disabledTopicIds,
  } as const;
}

export function knowledgeArticleMatchesEnabledTopics(
  articleTopicIds: unknown,
  topics: unknown,
) {
  const enabled = new Set(evaluateKnowledgeTopicPolicy(topics).enabledTopicIds);
  if (!Array.isArray(articleTopicIds)) return false;
  return articleTopicIds.some((topicId) => {
    const normalized = normalizeKnowledgeTopicId(topicId);
    return normalized ? enabled.has(normalized) : false;
  });
}
