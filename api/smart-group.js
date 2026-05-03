import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, message: '缺少文本' });
  }

  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekApiKey) {
    return res.status(500).json({ success: false, message: 'DeepSeek API Key 缺失' });
  }

  const deepseekClient = new OpenAI({
    apiKey: deepseekApiKey,
    baseURL: 'https://api.deepseek.com/v1',
  });

  try {
    const completion = await deepseekClient.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `你是一个假单解析助手。请将下面的文本解析为事由分组，并提取请假时间段。
输出格式必须为严格的 JSON 对象，包含两个字段：
{
  "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "groups": [
    { "reason": "事由名称", "leaveType": "leaveInside" 或 "leaveSchool" 或 "leaveOutside", "people": ["人名1", "人名2"] }
  ]
}
规则：
- 事由关键词映射：数分/网安/阿sir/数实战/网管 → leaveInside, reason为该关键词；
- 请假离校/离校 → leaveSchool, reason="请假离校"；
- 请假外出/外出 → leaveOutside, reason="请假外出"；
- 未匹配关键词的统一归为 leaveInside, reason="其他"。
- 人名必须是已知宿舍名单中的人（后端会验证），但模型只需要提取疑似人名的中文词。
- 从文本中提取请假时间段，支持常见中文表达，如：
  - "2026年4月30日至5月2日"
  - "4月30日-5月2日"
  - "5月1日请假一天" → start = end = 2026-05-01（年份默认为当前年份2026）
  - "请假时间：4月30日 ~ 5月2日"
- 如果无法提取到任何有效日期，dateRange 字段设为 null。
- 年份缺失时，使用当前年份 2026 年。
- 如果一张假单包含多个不同的日期，以最晚的结束日期为准。
- 如果有"长期请假"等无明确结束日期的描述，视为无法提取日期（dateRange = null）。
- 只输出 JSON，不要有任何额外文字或 markdown 包裹。`,
        },
        {
          role: 'user',
          content: text,
        },
      ],
      temperature: 0.1,
    });

    const rawContent = completion.choices[0]?.message?.content || '{}';
    let dateRange = null;
    let groups = [];
    try {
      // 有时模型会包裹在 markdown 代码块中，尝试提取
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) ||
                        rawContent.match(/```\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawContent.trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        // 兼容旧格式（纯数组）
        groups = parsed;
      } else if (parsed && typeof parsed === 'object') {
        dateRange = parsed.dateRange || null;
        groups = parsed.groups || [];
      }
      if (!Array.isArray(groups)) groups = [];
    } catch (e) {
      console.error('DeepSeek 返回的 JSON 解析失败:', rawContent);
      return res.status(500).json({ success: false, message: '模型返回格式错误' });
    }

    return res.status(200).json({ success: true, dateRange, groups });
  } catch (error) {
    console.error('Smart group error:', error);
    return res.status(500).json({ success: false, message: error.message || '智能分组失败' });
  }
}
