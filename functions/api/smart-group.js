// functions/api/smart-group.js
// 已移除 openai 依赖，改用原生 fetch 调用 DeepSeek API，兼容 Cloudflare Workers

import { jsonResponse, errorResponse, handleOptions, withErrorGuard } from './_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return handleOptions('POST, OPTIONS');
  }

  if (request.method !== 'POST') {
    return errorResponse('Method Not Allowed', 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('请求体解析失败', 400);
  }

  const { text } = body;
  if (!text) {
    return errorResponse('缺少文本', 400);
  }

  const deepseekApiKey = context.env.DEEPSEEK_API_KEY;
  if (!deepseekApiKey) {
    return errorResponse('DeepSeek API Key 缺失', 500);
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `你是一个假单解析助手。请将下面的文本解析为事由分组，并提取请假时间段。\n` +
              `输出格式必须为严格的 JSON 对象，包含两个字段：\n` +
              `{\n` +
              `  "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },\n` +
              `  "groups": [\n` +
              `    { "reason": "事由名称", "leaveType": "leaveInside" 或 "leaveSchool" 或 "leaveOutside", "people": ["人名1", "人名2"] }\n` +
              `  ]\n` +
              `}\n` +
              `规则（按优先级从高到低，同一人命中多个关键词时取最高优先级）：\n` +
              `优先级1（最高）— 请假离校/离校/回家 → leaveSchool, reason="请假离校"；\n` +
              `优先级2 — 请假外出/外出/出门 → leaveOutside, reason="请假外出"；\n` +
              `优先级3 — 组织/团队类：分团委/学生会/合唱团/运动会/警乐团/羽毛球/篮球队/篮球/辩论队/辩队/校督/校督促 → leaveInside, reason为该关键词；\n` +
              `优先级4（最低）— 工作室/学习类：数分/网安/阿sir/数实战/网管/舆情/备赛/复习/学习/自习 → leaveInside, reason为该关键词；\n` +
              `- 仅当文本明确出现"事假"二字且无更高优先级关键词时，归为 leaveInside, reason="其他"。\n` +
              `- 人名必须是已知宿舍名单中的人（后端会验证），但模型只需要提取疑似人名的中文词。\n` +
              `- 从文本中提取请假时间段，支持常见中文表达，如：\n` +
              `  - "2026年4月30日至5月2日"\n` +
              `  - "4月30日-5月2日"\n` +
              `  - "5月1日请假一天" → start = end = 2026-05-01（年份默认为当前年份2026）\n` +
              `  - "请假时间：4月30日 ~ 5月2日"\n` +
              `- 如果无法提取到任何有效日期，dateRange 字段设为 null。\n` +
              `- 年份缺失时，使用当前年份 2026 年。\n` +
              `- 如果一张假单包含多个不同的日期，以最晚的结束日期为准。\n` +
              `- 如果有"长期请假"等无明确结束日期的描述，视为无法提取日期（dateRange = null）。\n` +
              `- 只输出 JSON，不要有任何额外文字或 markdown 包裹。`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `DeepSeek API 错误: ${response.status}`);
    }

    const completion = await response.json();
    const rawContent = completion.choices?.[0]?.message?.content || '{}';

    let dateRange = null;
    let groups = [];
    try {
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) ||
                        rawContent.match(/```\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawContent.trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        groups = parsed;
      } else if (parsed && typeof parsed === 'object') {
        dateRange = parsed.dateRange || null;
        groups = parsed.groups || [];
      }
      if (!Array.isArray(groups)) groups = [];
    } catch (e) {
      console.error('DeepSeek 返回的 JSON 解析失败:', rawContent);
      return errorResponse('模型返回格式错误', 500);
    }

    return jsonResponse({ dateRange, groups });
  } catch (error) {
    console.error('Smart group error:', error);
    return errorResponse(error.message || '智能分组失败', 500);
  }
});
