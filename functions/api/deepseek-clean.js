// functions/api/deepseek-clean.js
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
            content: `你是 OCR 文本清洗助手。请对输入的原始假单文本进行智能清洗，去除噪声并输出为严格的标准纯文本格式。\n` +
              `\n` +
              `【输入】\n` +
              `从图片中 OCR 提取的原始文字，可能包含错别字、乱码、多余描述、宿舍编号、班级名、日期落款、无意义标点等。\n` +
              `\n` +
              `【输出格式】\n` +
              `只输出纯文本，格式如下（每行一个分组）：\n` +
              `事由1 人名A 人名B 人名C\n` +
              `事由2 人名D 人名E\n` +
              `- 每行代表一组具有相同事由的人员。\n` +
              `- 事由在前，后面跟该事由下的所有人名，人名之间用一个空格分隔。\n` +
              `- 不同组之间用换行分隔。\n` +
              `- 不要输出任何解释、JSON、Markdown 或额外标记。\n` +
              `\n` +
              `【清洗规则】\n` +
              `1. 去除无关内容：宿舍编号（如 604-1、512-106-3）、班级前缀（如 数据警务2401、情报2201）、大队名称（如 信息大队）、日期落款（如 2026年4月15日）、无意义标点和空白字符、描述性语句（如"由于备赛需要""恳请批准"等）。\n` +
              `2. 识别事由关键词（大小写不敏感）：\n` +
              `   - 工作室类：数分、网安、阿sir、数实战、网管\n` +
              `   - 活动类：分团委、学生会、合唱团、运动会、警乐团、羽毛球\n` +
              `   - 请假类：辩论队、备赛、复习、学习、校督\n` +
              `   - 离校/外出：请假离校、离校 → 统一输出"请假离校"；请假外出、外出 → 统一输出"请假外出"\n` +
              `   - 事假类（无具体事由）：事假 → 输出"事假"\n` +
              `3. 人名提取：提取中文姓名（2~4 个汉字），排除事由关键词；支持模糊匹配（如"杨欣"匹配"杨欣欣"，首字必须相同）；同一人名只出现一次（去重）。\n` +
              `4. 合并逻辑：如果多行属于同一事由，合并到一行；如果某行只有事由没有人名，忽略该行，但后续行如果没有明确事由，则继承该事由；事由和人名之间、人名与人名之间只用一个空格分隔。\n` +
              `5. 如果无法提取任何有效内容，返回空字符串 ""。\n` +
              `\n` +
              `【输出示例】\n` +
              `数分 何锐颖 杨欣欣 田宸菲\n` +
              `网安 李佳敏 王思琪\n` +
              `请假离校 张雅婷\n` +
              `辩论队 秦小斐\n` +
              `请假外出 陈思琪`,
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
    const formattedText = completion.choices?.[0]?.message?.content || text;
    return jsonResponse({ formattedText });
  } catch (error) {
    console.error('DeepSeek 清洗失败:', error);
    return errorResponse(error.message, 500);
  }
});
