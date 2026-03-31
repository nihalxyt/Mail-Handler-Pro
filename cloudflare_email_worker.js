export default {
  async email(message, env) {
    const API_URL = (env.API_ENDPOINT || "https://zayvex.cloud").replace(/\/$/, "");
    const API_KEY = env.INCOMING_MAIL_API_KEY || "";
    const MAX_BODY_SIZE = 512 * 1024;

    const to = message.to;
    const from = message.from;

    let rawEmail;
    try {
      rawEmail = await readStream(message.raw, MAX_BODY_SIZE * 2);
    } catch (e) {
      console.error("[ZayMail] Failed to read email stream:", e.message);
      return;
    }

    let subject = "";
    let body = "";
    let messageId = "";
    let dateHeader = "";
    let replyTo = "";
    let cc = "";
    let attachments = [];

    try {
      const headerEnd = rawEmail.indexOf("\r\n\r\n");
      const headerSection = headerEnd > -1 ? rawEmail.substring(0, headerEnd) : rawEmail;
      const bodySection = headerEnd > -1 ? rawEmail.substring(headerEnd + 4) : "";

      const headers = parseHeaders(headerSection);
      subject = decodeHeaderValue(headers["subject"] || "");
      messageId = headers["message-id"] || "";
      dateHeader = headers["date"] || "";
      replyTo = headers["reply-to"] || "";
      cc = headers["cc"] || "";

      const contentType = headers["content-type"] || "text/plain";
      const result = extractBody(bodySection, contentType);
      body = result.body;
      attachments = result.attachments || [];
    } catch (e) {
      console.error("[ZayMail] Parse error:", e.message);
      body = rawEmail.substring(0, MAX_BODY_SIZE);
    }

    if (body.length > MAX_BODY_SIZE) {
      body = body.substring(0, MAX_BODY_SIZE);
    }

    const payload = {
      to: to.toLowerCase().trim(),
      from: from || "",
      subject: subject || "(No Subject)",
      body: body || "",
      messageId,
      date: dateHeader,
      replyTo,
      cc,
      attachmentCount: attachments.length,
      attachments: attachments.slice(0, 10).map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size || 0,
      })),
    };

    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`${API_URL}/api/incoming-mail`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": API_KEY,
            "X-Worker-Version": "2.0",
            "X-Retry-Attempt": String(attempt),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          console.log(`[ZayMail] Email forwarded: ${to} from ${from} (attempt ${attempt})`);
          return;
        }

        const text = await response.text().catch(() => "");

        if (response.status >= 400 && response.status < 500) {
          console.error(`[ZayMail] Client error ${response.status}: ${text}`);
          return;
        }

        lastError = new Error(`Server error ${response.status}: ${text}`);
        console.warn(`[ZayMail] Attempt ${attempt}/${maxRetries} failed: ${response.status}`);
      } catch (err) {
        lastError = err;
        console.warn(`[ZayMail] Attempt ${attempt}/${maxRetries} error: ${err.message}`);
      }

      if (attempt < maxRetries) {
        await sleep(1000 * attempt);
      }
    }

    console.error(`[ZayMail] All ${maxRetries} attempts failed for ${to}:`, lastError?.message);
    throw lastError;
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStream(readableStream, maxSize) {
  const reader = readableStream.getReader();
  const chunks = [];
  let totalLen = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
    if (totalLen > maxSize) {
      reader.cancel();
      break;
    }
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

function parseHeaders(headerStr) {
  const headers = {};
  const unfolded = headerStr.replace(/\r?\n[ \t]+/g, " ");
  const lines = unfolded.split(/\r?\n/);

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      if (headers[key]) {
        headers[key] += ", " + value;
      } else {
        headers[key] = value;
      }
    }
  }

  return headers;
}

function decodeHeaderValue(value) {
  if (!value) return "";
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (match, charset, encoding, text) => {
      try {
        if (encoding.toUpperCase() === "B") {
          const binary = atob(text);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          try {
            return new TextDecoder(charset).decode(bytes);
          } catch {
            return binary;
          }
        } else if (encoding.toUpperCase() === "Q") {
          const decoded = text
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) =>
              String.fromCharCode(parseInt(hex, 16))
            );
          return decoded;
        }
      } catch {
        return text;
      }
      return text;
    }
  );
}

function extractBoundary(contentType) {
  const match = contentType.match(/boundary="?([^";\s]+)"?/i);
  return match ? match[1] : null;
}

function extractBody(bodyStr, contentType) {
  if (!bodyStr) return { body: "", attachments: [] };

  const ct = contentType.toLowerCase();

  if (ct.includes("multipart/")) {
    return parseMultipart(bodyStr, contentType);
  }

  if (ct.includes("text/html")) {
    return { body: decodePartBody(bodyStr, ct), attachments: [] };
  }

  return { body: decodePartBody(bodyStr, ct), attachments: [] };
}

function parseMultipart(bodyStr, contentType) {
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    return { body: bodyStr.substring(0, 50000), attachments: [] };
  }

  const parts = bodyStr.split("--" + boundary);
  let htmlPart = "";
  let textPart = "";
  const attachments = [];

  for (const part of parts) {
    if (part.startsWith("--") || !part.trim()) continue;

    const partHeaderEnd = part.indexOf("\r\n\r\n");
    if (partHeaderEnd < 0) continue;

    const partHeaderStr = part.substring(0, partHeaderEnd);
    const partBody = part.substring(partHeaderEnd + 4).replace(/\r?\n$/, "");
    const partHeaders = partHeaderStr.toLowerCase();

    const contentTypeMatch = partHeaderStr.match(/content-type:\s*([^\r\n;]+)/i);
    const partContentType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : "";

    const dispositionMatch = partHeaderStr.match(/content-disposition:\s*([^\r\n]+)/i);
    const disposition = dispositionMatch ? dispositionMatch[1] : "";

    if (disposition.toLowerCase().includes("attachment") || 
        (partContentType && !partContentType.startsWith("text/") && 
         !partContentType.startsWith("multipart/"))) {
      const filenameMatch = disposition.match(/filename="?([^";\r\n]+)"?/i) ||
                            partHeaderStr.match(/name="?([^";\r\n]+)"?/i);
      attachments.push({
        filename: filenameMatch ? decodeHeaderValue(filenameMatch[1].trim()) : "attachment",
        contentType: partContentType || "application/octet-stream",
        size: partBody.length,
      });
      continue;
    }

    if (partContentType.includes("multipart/")) {
      const nestedResult = parseMultipart(partBody, partHeaderStr.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "");
      if (nestedResult.body && !htmlPart) htmlPart = nestedResult.body;
      if (!htmlPart && nestedResult.body) textPart = nestedResult.body;
      attachments.push(...nestedResult.attachments);
      continue;
    }

    if (partContentType.includes("text/html") || partHeaders.includes("content-type: text/html")) {
      if (!htmlPart) {
        htmlPart = decodePartBody(partBody, partHeaders);
      }
    } else if (partContentType.includes("text/plain") || partHeaders.includes("content-type: text/plain")) {
      if (!textPart) {
        textPart = decodePartBody(partBody, partHeaders);
      }
    }
  }

  return {
    body: htmlPart || textPart || bodyStr.substring(0, 5000),
    attachments,
  };
}

function decodePartBody(body, headers) {
  const h = typeof headers === "string" ? headers.toLowerCase() : "";

  if (h.includes("content-transfer-encoding: base64")) {
    try {
      const cleaned = body.replace(/[\s\r\n]/g, "");
      const binary = atob(cleaned);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const charsetMatch = h.match(/charset="?([^";\s]+)"?/);
      const charset = charsetMatch ? charsetMatch[1] : "utf-8";
      try {
        return new TextDecoder(charset, { fatal: false }).decode(bytes);
      } catch {
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
    } catch {
      return body;
    }
  }

  if (h.includes("content-transfer-encoding: quoted-printable")) {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
  }

  return body;
}
