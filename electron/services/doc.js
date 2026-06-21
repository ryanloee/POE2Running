// 文档解析层:把用户上传的「目标 BD 文档」转成纯文本
// 支持:Word(.docx, mammoth)、PPT(.pptx, JSZip 提取 slide 文本)、纯文本(.txt/.md)、图片(base64)
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const JSZip = require('jszip');

/**
 * 根据扩展名解析文档,返回 { text, images }
 */
async function parse(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.docx':
      return parseDocx(filePath);
    case '.doc':
      return { text: '[旧版 .doc 格式不支持,请另存为 .docx 后重试]', images: [] };
    case '.pptx':
      return parsePptx(filePath);
    case '.txt':
    case '.md':
    case '.csv':
      return { text: fs.readFileSync(filePath, 'utf8'), images: [] };
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
      return parseImage(filePath);
    default:
      try {
        return { text: fs.readFileSync(filePath, 'utf8'), images: [] };
      } catch (e) {
        return { text: `[不支持的文件类型: ${ext}]`, images: [] };
      }
  }
}

async function parseDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return { text: result.value || '(空文档)', images: [] };
  } catch (e) {
    return { text: `[Word 解析失败: ${e.message}]`, images: [] };
  }
}

async function parsePptx(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(data);
    const slideFiles = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/slide(\d+)/)[1], 10) - parseInt(b.match(/slide(\d+)/)[1], 10));

    const pages = [];
    for (const sf of slideFiles) {
      const xml = await zip.files[sf].async('string');
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]));
      const pageText = texts.filter(Boolean).join(' ');
      if (pageText.trim()) {
        const num = sf.match(/slide(\d+)/)[1];
        pages.push(`【第${num}页】${pageText}`);
      }
    }
    return { text: pages.length ? pages.join('\n') : '(PPT 无文本,可能是纯图片,建议截图后用图片识别或改用文字描述)', images: [] };
  } catch (e) {
    return { text: `[PPT 解析失败: ${e.message}]`, images: [] };
  }
}

function parseImage(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const b64 = fs.readFileSync(filePath).toString('base64');
  return {
    text: `[图片: ${path.basename(filePath)},需结合视觉理解;以下分析基于其他文字信息]`,
    images: [{ name: path.basename(filePath), data: `data:image/${mime};base64,${b64}` }],
  };
}

function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

module.exports = { parse };
