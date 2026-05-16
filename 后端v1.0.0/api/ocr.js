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
            '你是一位数据整理助手。请从给定的假单文本中提取所有人名及其对应的事由（如数分、网安、阿sir、辩论队、备赛、请假离校、请假外出等）。输出格式要求：每行一个分组，格式为"事由 人名1 人名2 ..."，事由在前，人名以空格分隔。如果有多组，用换行分隔。不要输出任何解释性文字。',
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
