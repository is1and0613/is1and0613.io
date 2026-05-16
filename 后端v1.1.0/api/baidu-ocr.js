// api/baidu-ocr.js
import formidable from 'formidable';
import fs from 'fs';

async function getAccessToken(apiKey, secretKey) {
  const response = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
    { method: 'POST' }
  );
  const data = await response.json();
  return data.access_token;
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ uploadDir: '/tmp', keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false });
  }

  try {
    const { files } = await parseForm(req);
    const file = files.image?.[0] || files.file?.[0];
    if (!file) {
      return res.status(400).json({ success: false, message: '未收到图片' });
    }

    const imageBase64 = fs.readFileSync(file.filepath, { encoding: 'base64' });

    const accessToken = await getAccessToken(
      process.env.BAIDU_OCR_API_KEY,
      process.env.BAIDU_OCR_SECRET_KEY
    );

    const ocrResponse = await fetch(
      `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ image: imageBase64 })
      }
    );

    const ocrData = await ocrResponse.json();
    
    // 清理临时文件
    try { fs.unlinkSync(file.filepath); } catch(e) {}

    if (ocrData.words_result) {
      const text = ocrData.words_result.map(item => item.words).join('\n');
      return res.status(200).json({ success: true, formattedText: text });
    } else {
      return res.status(200).json({ success: false, message: ocrData.error_msg || '识别失败' });
    }
  } catch (error) {
    console.error('Baidu OCR error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
}