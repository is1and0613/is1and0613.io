import formidable from 'formidable';
import fs from 'fs';

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

/**
 * 安全清理临时文件
 */
function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    // 忽略清理错误
  }
}

/**
 * 获取百度 OCR access_token（带简单内存缓存）
 */
let baiduTokenCache = null;
let baiduTokenExpireAt = 0;

async function getBaiduAccessToken(apiKey, secretKey) {
  // 缓存未过期则直接返回
  if (baiduTokenCache && Date.now() < baiduTokenExpireAt) {
    return baiduTokenCache;
  }

  const response = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
    { method: 'POST' }
  );
  const data = await response.json();

  if (!data.access_token) {
    throw new Error(data.error_msg || '获取百度 OCR Token 失败');
  }

  baiduTokenCache = data.access_token;
  // 提前 5 分钟过期，避免边界问题
  baiduTokenExpireAt = Date.now() + (data.expires_in || 2592000) * 1000 - 5 * 60 * 1000;
  return baiduTokenCache;
}

/**
 * 调用百度 OCR 识别图片
 */
async function baiduOcr(filePath) {
  const apiKey = process.env.BAIDU_OCR_API_KEY;
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error('百度 OCR 环境变量未配置');
  }

  const imageBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
  const accessToken = await getBaiduAccessToken(apiKey, secretKey);

  const ocrResponse = await fetch(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ image: imageBase64 }),
    }
  );

  const ocrData = await ocrResponse.json();

  if (ocrData.words_result && ocrData.words_result.length > 0) {
    return ocrData.words_result.map((item) => item.words).join('\n');
  }

  throw new Error(ocrData.error_msg || '百度 OCR 未识别到文字');
}

export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  let filePath = null;

  try {
    // 1. 解析上传的文件
    const { files } = await parseForm(req);
    const uploadedFile = files.image?.[0] || files.file?.[0] || files.image || files.file;

    if (!uploadedFile) {
      return res.status(400).json({ success: false, message: '未收到图片文件' });
    }

    filePath = uploadedFile.filepath || uploadedFile.path;

    // 2. 直接调用百度 OCR
    const extractedText = await baiduOcr(filePath);

    safeUnlink(filePath);

    if (!extractedText || !extractedText.trim()) {
      return res.status(200).json({
        success: false,
        message: '未能从图片中提取到文字',
        formattedText: '',
      });
    }

    return res.status(200).json({
      success: true,
      formattedText: extractedText,
    });
  } catch (error) {
    safeUnlink(filePath);
    console.error('OCR error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || '识别失败，请稍后重试',
    });
  }
}
