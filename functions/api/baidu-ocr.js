// functions/api/baidu-ocr.js
// 已移除 formidable/fs 依赖，改用原生 FormData + ArrayBuffer，兼容 Cloudflare Workers

import { jsonResponse, errorResponse, handleOptions } from './_utils.js';

async function getAccessToken(apiKey, secretKey) {
  const response = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
    { method: 'POST' }
  );
  const data = await response.json();
  return data.access_token;
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
    const file = formData.get('image') || formData.get('file');
    if (!file) {
      return errorResponse('未收到图片', 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const imageBase64 = btoa(binary);

    const accessToken = await getAccessToken(
      context.env.BAIDU_OCR_API_KEY,
      context.env.BAIDU_OCR_SECRET_KEY
    );

    const ocrResponse = await fetch(
      `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ image: imageBase64 }),
      }
    );

    const ocrData = await ocrResponse.json();

    if (ocrData.words_result) {
      const text = ocrData.words_result.map((item) => item.words).join('\n');
      return jsonResponse({ formattedText: text });
    } else {
      return errorResponse(ocrData.error_msg || '识别失败');
    }
  } catch (error) {
    console.error('Baidu OCR error:', error);
    return errorResponse(error.message, 500);
  }
}
