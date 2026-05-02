export function parseToolResult(result) {
  const text = result?.content?.[0]?.text ?? "";
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return {
    raw: result,
    text,
    data,
    structured: result?.structuredContent,
    isError: Boolean(
      result?.isError
      || (data && typeof data === "object" && data.ok === false)
    ),
  };
}

export async function callToolParsed(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return parseToolResult(result);
}
