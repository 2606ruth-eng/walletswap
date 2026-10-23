export function toResponsesTools(definitions) {
  return definitions.map(definition => ({
    type: "function",
    name: definition.function.name,
    description: definition.function.description,
    parameters: strictParameters(definition.function.parameters),
    strict: true,
  }));
}

function strictParameters(parameters) {
  const required = new Set(parameters.required || []);
  const properties = Object.fromEntries(Object.entries(parameters.properties || {}).map(([name, schema]) => {
    const strictSchema = { ...schema };
    if (!required.has(name) && typeof schema.type === "string") {
      strictSchema.type = [schema.type, "null"];
    }
    return [name, strictSchema];
  }));
  return {
    ...parameters,
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export function conversationInput(history, message) {
  return [
    ...history.map(item => ({ role: item.role, content: item.content })),
    { role: "user", content: message },
  ];
}

export function responseFunctionCalls(response) {
  return (Array.isArray(response?.output) ? response.output : [])
    .filter(item => item?.type === "function_call")
    .map(item => ({
      callId: String(item.call_id || ""),
      name: String(item.name || ""),
      arguments: String(item.arguments || ""),
    }));
}

export function responseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (Array.isArray(response?.output) ? response.output : [])
    .filter(item => item?.type === "message")
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(item => item?.type === "output_text" && typeof item.text === "string")
    .map(item => item.text)
    .join("");
}
