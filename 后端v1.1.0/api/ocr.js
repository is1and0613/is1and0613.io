import formidable from 'formidable';
import fs from 'fs';
import OpenAI from 'openai';

/**
 * 使用 formidable 解析上传的文件
 */
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFiles: 1,
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const kimiApiKey = process.env.KIMI_API_KEY;
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;

  if (!kimiApiKey || !deepseekApiKey) {
    return res.status(500).json({
      success: false,
      message: '服务器 API Key 配置缺失',
    });
  }

  try {
    // 1. 解析上传的文件
    const { files } = await parseForm(req);
    const uploadedFile = files.image?.[0] || files.file?.[0] || files.image || files.file;

    if (!uploadedFile) {
      return res.status(400).json({ success: false, message: '未收到图片文件' });
    }

    const filePath = uploadedFile.filepath || uploadedFile.path;

    // 2. 初始化 Kimi 客户端
    const kimiClient = new OpenAI({
      apiKey: kimiApiKey,
      baseURL: 'https://api.moonshot.cn/v1',
    });

    // 3. 上传文件到 Kimi（purpose="file-extract"）
    const fileStream = fs.createReadStream(filePath);
    const kimiFile = await kimiClient.files.create({
      file: fileStream,
      purpose: 'file-extract',
    });

    // 4. 等待文件处理完成
    let fileStatus = await kimiClient.files.retrieve(kimiFile.id);
    let retries = 0;
    while (
      fileStatus.status !== 'ok' &&
      fileStatus.status !== 'processed' &&
      retries < 30
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      fileStatus = await kimiClient.files.retrieve(kimiFile.id);
      retries++;
    }

    // 5. 获取文件提取的原始文字
    const content = await kimiClient.files.content(kimiFile.id);
    const extractedText = await content.text();

    if (!extractedText.trim()) {
      // 清理临时文件
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        // 忽略清理错误
      }
      return res.status(200).json({
        success: false,
        message: '未能从图片中提取到文字',
        rawText: '',
        formattedText: '',
      });
    }

    // 6. 调用 Kimi 整理提取的文字（保持排版）
    const extractCompletion = await kimiClient.chat.completions.create({
      model: 'moonshot-v1-8k',
      messages: [
        {
          role: 'system',
          content:
            '你是 OCR 助手。请精确提取图片中的所有文字内容，保持原有排版和换行，不要添加任何解释。',
        },
        {
          role: 'user',
          content: extractedText,
        },
      ],
      temperature: 0.1,
    });

    const rawText = extractCompletion.choices[0]?.message?.content || extractedText;

    if (!rawText.trim()) {
      // 清理临时文件
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        // 忽略清理错误
      }
      return res.status(200).json({
        success: false,
        message: '未能从图片中提取到文字',
        rawText: '',
        formattedText: '',
      });
    }

    // 7. 调用 DeepSeek 整理提取的文字（提取人名和事由）
    const deepseekClient = new OpenAI({
      apiKey: deepseekApiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });

    const formatCompletion = await deepseekClient.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content:
            `你是 OCR 文本清洗助手。请对输入的原始假单文本进行智能清洗，去除噪声并输出为严格的标准纯文本格式。\n` +
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
            `1. 去除无关内容：宿舍编号（如 604-1、512-106-3）、班级前缀（如 数据警务2401、情报2201）、日期落款（如 2026年4月15日）、无意义标点和空白字符、描述性语句（如“由于备赛需要”“恳请批准”等）。\n` +
            `2. 识别事由关键词（大小写不敏感）：\n` +
            `   - 工作室类：数分、网安、阿sir、数实战、网管\n` +
            `   - 活动类：分团委、学生会、合唱团、运动会、警乐团、羽毛球\n` +
            `   - 请假类：辩论队、备赛、复习、学习、校督\n` +
            `   - 离校/外出：请假离校、离校 → 统一输出“请假离校”；请假外出、外出 → 统一输出“请假外出”\n` +
            `   - 事假类（无具体事由）：事假 → 输出“事假”\n` +
            `3. 人名提取：提取中文姓名（2~4 个汉字），排除事由关键词；支持模糊匹配（如“杨欣”匹配“杨欣欣”，首字必须相同）；同一人名只出现一次（去重）。\n` +
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
        {
          role: 'user',
          content: rawText,
        },
      ],
      temperature: 0.1,
    });

    const formattedText = formatCompletion.choices[0]?.message?.content || rawText;

    // 8. 清理临时文件
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      // 忽略清理错误
    }

    return res.status(200).json({
      success: true,
      rawText,
      formattedText,
    });
  } catch (error) {
    console.error('OCR error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || '识别失败，请稍后重试',
    });
  }
}
