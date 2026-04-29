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
          content: `你是一个假单解析助手。请将下面的文本解析为事由分组。
输出格式必须为严格的 JSON 数组，每个元素包含：
{
  "reason": "事由名称",
  "leaveType": "leaveInside" 或 "leaveSchool" 或 "leaveOutside",
  "people": ["人名1", "人名2"]
}
规则：
- 事由关键词映射：数分/网安/阿sir/数实战/网管 → leaveInside, reason为该关键词；
- 请假离校/离校 → leaveSchool, reason="请假离校"；
- 请假外出/外出 → leaveOutside, reason="请假外出"；
- 未匹配关键词的统一归为 leaveInside, reason="其他"。
- 人名必须是已知宿舍名单中的人（后端会验证），但模型只需要提取疑似人名的中文词。
- 只输出 JSON，不要有任何额外文字。`,
        },
        {
          role: 'user',
          content: text,
        },
      ],
      temperature: 0.1,
    });

    const rawContent = completion.choices[0]?.message?.content || '[]';
    let groups = [];
    try {
      // 有时模型会包裹在 markdown 代码块中，尝试提取
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) ||
                        rawContent.match(/```\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawContent.trim();
      groups = JSON.parse(jsonStr);
      if (!Array.isArray(groups)) groups = [];
    } catch (e) {
      console.error('DeepSeek 返回的 JSON 解析失败:', rawContent);
      return res.status(500).json({ success: false, message: '模型返回格式错误' });
    }

    return res.status(200).json({ success: true, groups });
  } catch (error) {
    console.error('Smart group error:', error);
    return res.status(500).json({ success: false, message: error.message || '智能分组失败' });
  }
}
