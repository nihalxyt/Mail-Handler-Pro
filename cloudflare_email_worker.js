export default {
  async email(message, env) {
    const API_URL = env.API_ENDPOINT || "https://your-api-domain.com";
    const API_KEY = env.INCOMING_MAIL_API_KEY || "";

    const to = message.to;
    const from = message.from;
    const rawEmail = await readStream(message.raw);

    let subject = "";
    let body = "";
    let messageId = "";
    let dateHeader = "";

    try {
      const headerEnd = rawEmail.indexOf("\r\n\r\n");
      const headerSection =
        headerEnd > -1 ? rawEmail.substring(0, headerEnd) : rawEmail;
      const bodySection =
        headerEnd > -1 ? rawEmail.substring(headerEnd + 4) : "";

      const headers = parseHeaders(headerSection);
      subject = decodeHeaderValue(headers["subject"] || "");
      messageId = headers["message-id"] || "";
      dateHeader = headers["date"] || "";

      body = extractBody(bodySection, headers["content-type"] || "");
    } catch (e) {
      console.error("Parse error:", e);
      body = rawEmail;
    }

    const payload = {
      to: to.toLowerCase().trim(),
      from: from || "",
      subject: subject || "(No Subject)",
      body: body || "",
      messageId,
      date: dateHeader,
    };

    try {
      const response = await fetch(`${API_URL}/api/incoming-mail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`API responded ${response.status}: ${text}`);
      }
    } catch (err) {
      console.error("Failed to forward email:", err);
      throw err;
    }
  },
};

async function readStream(readableStream) {
  const reader = readableStream.getReader();
  const chunks = [];
  let totalLen = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
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
  const lines = headerStr.replace(/\r\n\s+/g, " ").split("\r\n");

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      headers[key] = value;
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
          const bytes = atob(text);
          return bytes;
        } else if (encoding.toUpperCase() === "Q") {
          return text
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) =>
              String.fromCharCode(parseInt(hex, 16))
            );
        }
      } catch {
        return text;
      }
      return text;
    }
  );
}

function extractBody(bodyStr, contentType) {
  if (!bodyStr) return "";

  const ct = contentType.toLowerCase();

  if (ct.includes("multipart/")) {
    const boundaryMatch = ct.match(/boundary="?([^";\s]+)"?/);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = bodyStr.split("--" + boundary);
      let htmlPart = "";
      let textPart = "";

      for (const part of parts) {
        if (part.startsWith("--") || !part.trim()) continue;

        const partHeaderEnd = part.indexOf("\r\n\r\n");
        if (partHeaderEnd < 0) continue;

        const partHeaders = part.substring(0, partHeaderEnd).toLowerCase();
        const partBody = part.substring(partHeaderEnd + 4).trim();

        if (partHeaders.includes("content-type: text/html") && !htmlPart) {
          htmlPart = decodePartBody(partBody, partHeaders);
        } else if (
          partHeaders.includes("content-type: text/plain") &&
          !textPart
        ) {
          textPart = decodePartBody(partBody, partHeaders);
        }
      }

      return htmlPart || textPart || bodyStr.substring(0, 5000);
    }
  }

  return bodyStr.substring(0, 50000);
}

function decodePartBody(body, headers) {
  if (headers.includes("content-transfer-encoding: base64")) {
    try {
      return atob(body.replace(/\s/g, ""));
    } catch {
      return body;
    }
  }
  if (headers.includes("content-transfer-encoding: quoted-printable")) {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
  }
  return body;
}
