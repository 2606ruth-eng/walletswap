const MICROS_PER_MILLION = 1_000_000n;
const MAX_MONTHLY_BUDGET_MICROS = 100_000_000n;

function decimalMicros(value) {
  if (typeof value !== "string" || !/^\d{1,6}(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}

export function rubyCostConfiguration(env) {
  const inputRate = decimalMicros(env.RUBY_INPUT_COST_PER_MILLION_USD);
  const outputRate = decimalMicros(env.RUBY_OUTPUT_COST_PER_MILLION_USD);
  const monthlyLimit = decimalMicros(env.RUBY_MONTHLY_BUDGET_USD);
  const model = env.RUBY_OPENAI_MODEL || "gpt-4o-mini";
  if (!inputRate || !outputRate || !monthlyLimit || monthlyLimit > MAX_MONTHLY_BUDGET_MICROS
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(model)) {
    return null;
  }
  return { inputRate, outputRate, monthlyLimit, model };
}

export function estimateRubyCostMicros(inputTokens, outputTokens, rates) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0
    || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
    throw new Error("Token estimate is invalid");
  }
  const numerator = BigInt(inputTokens) * rates.inputRate
    + BigInt(outputTokens) * rates.outputRate;
  return (numerator + MICROS_PER_MILLION - 1n) / MICROS_PER_MILLION;
}

export function rubyUsageFromResponse(payload) {
  const inputTokens = payload?.usage?.input_tokens;
  const outputTokens = payload?.usage?.output_tokens;
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0
    || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
    return null;
  }
  return { inputTokens, outputTokens };
}

export function formatRubyCostMicros(costMicros) {
  return costMicros.toString();
}
