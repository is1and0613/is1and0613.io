// functions/api/ocr.js
// 已移除 formidable/fs 依赖，改用原生 FormData + ArrayBuffer，兼容 Cloudflare Workers

import { jsonResponse, errorResponse, handleOptions } from './_utils.js';

/**
 * 获取百度 OCR access_token（带简单内存缓存）
 */
let baiduTokenCache = null;
let baiduTokenExpireAt = 0;

async function getBaiduAccessToken(apiKey, secretKey) {
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
  baiduTokenExpireAt = Date.now() + (data.expires_in || 2592000) * 1000 - 5 * 60 * 1000;
  return baiduTokenCache;
}

/**
 * 调用百度 OCR 识别图片
 */
async function baiduOcr(arrayBuffer, env) {
  const apiKey = env.BAIDU_OCR_API_KEY;
  const secretKey = env.BAIDU_OCR_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error('百度 OCR 环境变量未配置');
  }

  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const imageBase64 = btoa(binary);

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

export async function onRequest(context) {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return handleOptions('POST, OPTIONS');
  }

  if (request.method !== 'POST') {
    return errorResponse('Method Not Allowed', 405);
  }

  try {
    const formData = await request.formData();
    const uploadedFile = formData.get('image') || formData.get('file');

    if (!uploadedFile) {
      return errorResponse('未收到图片文件', 400);
    }

    const arrayBuffer = await uploadedFile.arrayBuffer();
    const extractedText = await baiduOcr(arrayBuffer, context.env);

    if (!extractedText || !extractedText.trim()) {
      return jsonResponse({ message: '未能从图片中提取到文字', formattedText: '' });
    }

    return jsonResponse({ formattedText: extractedText });
  } catch (error) {
    console.error('OCR error:', error);
    return errorResponse(error.message || '识别失败，请稍后重试', 500);
  }
}
