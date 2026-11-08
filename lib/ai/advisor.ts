import {parseFinancialBrief} from '../finance/brief-parser';

export async function generateAdvisorBrief(snapshot: unknown) {
  if (!process.env.OPENAI_API_KEY || process.env.AI_WEEKLY_BRIEF_ENABLED !== 'true') return null;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json'},
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      store: false,
      instructions: 'Explain only the calculated household CAD figures supplied. Keep the summary to two sentences and suggest two to five practical actions. Do not infer causes, balances, eligibility, returns, tax rules, or the ability to transfer money.',
      input: JSON.stringify(snapshot),
      text: {format: {type: 'json_schema', name: 'financial_brief', strict: true, schema: {
        type: 'object', additionalProperties: false, required: ['brief', 'actions', 'dataQualityCaveats'],
        properties: {brief: {type: 'string'}, actions: {type: 'array', items: {type: 'string'}}, dataQualityCaveats: {type: 'array', items: {type: 'string'}}}
      }}},
      max_output_tokens: 650
    })
  });
  if (!response.ok) return null;
  const result = await response.json();
  const output = (result.output ?? []).flatMap((item: {content?: {type: string; text?: string}[]}) => item.content ?? [])
    .filter((item: {type: string}) => item.type === 'output_text').map((item: {text?: string}) => item.text).join('\n');
  return parseFinancialBrief(output);
}
