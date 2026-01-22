import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import OpenAI from "npm:openai";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const OPENAI_FALLBACK_MODEL = "gpt-4o-mini";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const getSupabaseClient = () => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const key = serviceRoleKey || anonKey;
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createClient(url, key, { auth: { persistSession: false } });
};

const isOpenAiModel = (model?: string) => {
  const normalized = (model ?? '').toLowerCase();
  return normalized.startsWith('gpt-') || normalized.startsWith('o1');
};

const normalizePromptText = (prompt: unknown) => {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) return prompt.join('\n');
  return '';
};

const buildOpenAiContent = (prompt: string, imageParts?: any[]) => {
  if (!imageParts || !Array.isArray(imageParts) || imageParts.length === 0) {
    return prompt;
  }

  const content: any[] = [{ type: 'text', text: prompt }];
  imageParts.forEach((part: any) => {
    const data = part?.inlineData?.data;
    if (!data) return;
    const mimeType = part?.inlineData?.mimeType || 'image/jpeg';
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${data}`
      }
    });
  });

  return content;
};

const createOpenAiClient = () => {
  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: openAiKey });
};

const normalizeSchemaType = (schema?: any) =>
  (schema?.type || schema?.Type || '').toString().toUpperCase();

const buildOpenAiSystemPrompt = (schema?: any) => {
  const schemaType = normalizeSchemaType(schema);
  if (schemaType === 'ARRAY') {
    return 'Return only a valid JSON array. Do not include any extra text.';
  }
  if (schemaType === 'OBJECT') {
    return 'Return only a valid JSON object. Do not include any extra text.';
  }
  return 'You are a helpful assistant.';
};

const buildOpenAiResponseFormat = (schema?: any) => {
  const schemaType = normalizeSchemaType(schema);
  if (schemaType === 'OBJECT') {
    return { type: "json_object" } as const;
  }
  return undefined;
};

const extractJsonPayload = (text: string) => {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    return cleaned;
  }
  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return cleaned.slice(arrayStart, arrayEnd + 1);
  }
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    return cleaned.slice(objStart, objEnd + 1);
  }
  return cleaned;
};

const mapModelErrorMessage = (error: any) => {
  const rawMessage = (error?.message || error?.error?.message || '').toString();
  const code = (error?.code || error?.error?.code || '').toString();
  const status = Number(error?.status || error?.statusCode || 0);
  const normalized = rawMessage.toLowerCase();

  const isModelNotFound =
    code === 'model_not_found' ||
    normalized.includes('model_not_found') ||
    normalized.includes('model not found') ||
    normalized.includes('unknown model') ||
    normalized.includes('does not exist') ||
    normalized.includes('unsupported model') ||
    status === 404;

  if (isModelNotFound) {
    return 'Selected LLM model is not available. Please choose another model.';
  }

  return rawMessage || 'Unexpected error occurred in LLM proxy.';
};

const logPayloadMetrics = (action: string, payload: any) => {
  try {
    const metrics: string[] = [];
    if (payload?.imageParts?.length) {
      const first = payload.imageParts[0];
      const base64Length = first?.inlineData?.data?.length || 0;
      metrics.push(`imageParts=${payload.imageParts.length}`);
      metrics.push(`firstPartSize≈${base64Length} chars`);
    }
    if (payload?.prompt) {
      const promptLength = typeof payload.prompt === 'string'
        ? payload.prompt.length
        : Array.isArray(payload.prompt) ? payload.prompt.length : 0;
      metrics.push(`promptLength=${promptLength}`);
    }
    if (payload?.questions?.length) {
      metrics.push(`questions=${payload.questions.length}`);
    }
    console.log(`[PayloadMetrics][${action}] ${metrics.join(' | ') || 'no notable metrics'}`);
  } catch (err) {
    console.warn('Failed to log payload metrics', err);
  }
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const { action, payload } = await req.json();

    console.log(`Processing action: ${action}`);
    logPayloadMetrics(action, payload);

    let result;
    let warning: string | null = null;

    switch (action) {
      case 'ingestionStart': {
        const supabase = getSupabaseClient();
        const payloadBody = payload || {};
        const {
          certification,
          subject,
          year,
          exam_session,
          source,
          request_payload,
          structure_analysis,
          problem_class,
          solve_input,
          solver_output,
          verification_result,
          failure_reason,
          status
        } = payloadBody;

        let derivedStatus = status || 'RECEIVED';
        if (!status) {
          if (verification_result) derivedStatus = 'VERIFIED';
          else if (solver_output) derivedStatus = 'SOLVED';
          else if (problem_class || solve_input) derivedStatus = 'CLASSIFIED';
          else if (structure_analysis) derivedStatus = 'STRUCTURED';
        }

        const { data, error } = await supabase
          .from('ingestion_jobs')
          .insert({
            certification,
            subject,
            year,
            exam_session,
            source,
            request_payload,
            structure_analysis,
            problem_class,
            solve_input,
            solver_output,
            verification_result,
            failure_reason,
            status: derivedStatus
          })
          .select('id,status')
          .single();

        if (error) {
          throw new Error(error.message || 'Failed to create ingestion job');
        }

        result = data;
        break;
      }
      case 'generateContent': {
        // Generic content generation
        const { model, prompt, schema, imageParts } = payload;
        const modelName = model || DEFAULT_GEMINI_MODEL;
        const generationConfig: any = {};

        if (schema) {
          generationConfig.responseMimeType = "application/json";
          generationConfig.responseSchema = schema;
        }

        try {
          if (isOpenAiModel(modelName)) {
            const openai = createOpenAiClient();
            const schemaNote = schema
              ? `\n\nJSON schema:\n${JSON.stringify(schema)}`
              : '';
            const systemPrompt = buildOpenAiSystemPrompt(schema);
            const userPrompt = `${normalizePromptText(prompt)}${schemaNote}`;
            const content = buildOpenAiContent(userPrompt, imageParts);

            const completion = await openai.chat.completions.create({
              model: modelName,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content }
              ],
              response_format: buildOpenAiResponseFormat(schema)
            });

            result = completion.choices[0]?.message?.content || '';
            break;
          }

          const geminiModel = genAI.getGenerativeModel({
            model: modelName,
            generationConfig
          });

          // Build parts array
          const parts = [];
          if (typeof prompt === 'string') {
            parts.push({ text: prompt });
          }
          if (imageParts && Array.isArray(imageParts)) {
            parts.push(...imageParts);
          }

          const response = await geminiModel.generateContent(parts);
          result = response.response.text();
        } catch (geminiError) {
          console.warn('Gemini generateContent failed, falling back to OpenAI.');
          const openai = createOpenAiClient();
          const schemaNote = schema
            ? `\n\nJSON schema:\n${JSON.stringify(schema)}`
            : '';
          const systemPrompt = buildOpenAiSystemPrompt(schema);
          const userPrompt = `${normalizePromptText(prompt)}${schemaNote}`;
          const content = buildOpenAiContent(userPrompt, imageParts);

          const completion = await openai.chat.completions.create({
            model: OPENAI_FALLBACK_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content }
            ],
            response_format: buildOpenAiResponseFormat(schema)
          });

          result = completion.choices[0]?.message?.content || '';
        }
        break;
      }

      case 'analyzeImage': {
        const { prompt, imageParts, schema, model } = payload;
        const modelName = model || DEFAULT_GEMINI_MODEL;
        const generationConfig: any = {
          responseMimeType: "application/json",
          responseSchema: schema,
        };

        if (isOpenAiModel(modelName)) {
          try {
            const openai = createOpenAiClient();
            const schemaNote = schema
              ? `\n\nJSON schema:\n${JSON.stringify(schema)}`
              : '';
            const userPrompt = `${normalizePromptText(prompt)}${schemaNote}`;
            const content = buildOpenAiContent(userPrompt, imageParts);
            const completion = await openai.chat.completions.create({
              model: modelName,
              messages: [
                { role: 'system', content: buildOpenAiSystemPrompt(schema) },
                { role: 'user', content }
              ],
              response_format: buildOpenAiResponseFormat(schema)
            });
            const text = completion.choices[0]?.message?.content || '';
            const payloadText = extractJsonPayload(text);
            result = JSON.parse(payloadText);
            break;
          } catch (openAiError) {
            console.warn('OpenAI analyzeImage failed, falling back to Gemini.', openAiError);
            warning = 'OpenAI 모델 호출에 실패해 Gemini로 재시도했습니다.';
          }
        }

        const geminiModel = genAI.getGenerativeModel({
          model: modelName,
          generationConfig
        });

        const parts = [{ text: prompt }, ...imageParts];
        const response = await geminiModel.generateContent(parts);
        const text = response.response.text();

        // Robust cleaning of AI output (remove markdown backticks if present)
        const cleanJson = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
        result = JSON.parse(cleanJson);
        break;
      }

      case 'generateVariant': {
        const { prompt, schema, model } = payload;
        const modelName = model || DEFAULT_GEMINI_MODEL;
        const generationConfig: any = {
          responseMimeType: "application/json",
          responseSchema: schema,
        };

        if (isOpenAiModel(modelName)) {
          const openai = createOpenAiClient();
          const schemaNote = schema
            ? `\n\nJSON schema:\n${JSON.stringify(schema)}`
            : '';
          const userPrompt = `${normalizePromptText(prompt)}${schemaNote}`;
          const completion = await openai.chat.completions.create({
            model: modelName,
            messages: [
              { role: 'system', content: buildOpenAiSystemPrompt(schema) },
              { role: 'user', content: userPrompt }
            ],
            response_format: buildOpenAiResponseFormat(schema)
          });
          const text = completion.choices[0]?.message?.content || '';
          const payloadText = extractJsonPayload(text);
          result = JSON.parse(payloadText);
          break;
        }

        const geminiModel = genAI.getGenerativeModel({
          model: modelName,
          generationConfig
        });

        const response = await geminiModel.generateContent(prompt);
        const text = response.response.text();

        // Robust cleaning
        const cleanJson = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
        result = JSON.parse(cleanJson);
        break;
      }

      case 'explanationChat': {
        const { question, model } = payload;
        const modelName = model || DEFAULT_GEMINI_MODEL;
        if (!question || !Array.isArray(question.options)) {
          throw new Error('Invalid question payload for explanation chat');
        }

        const optionList = question.options
          .map((option: string, index: number) => `${String.fromCharCode(65 + index)}. ${option}`)
          .join('\n');

        const prompt = `
[문제 요약]
자격증: ${question.certification || '미지정'}
과목: ${question.subject || '미지정'}
문제: ${question.questionText}

[선택지]
${optionList}

[정답 정보]
${typeof question.answerIndex === 'number'
            ? `정답 선택지: ${String.fromCharCode(65 + question.answerIndex)} (${question.options[question.answerIndex] || ''})`
            : '정답 미제공'}

[참고 자료]
${question.rationale || question.aiExplanation || question.hint || '없음'}

[지시 사항]
1. 참고 자료는 참고만 하고 그대로 복사하지 말 것
2. 첫 응답부터 완성된 해설을 제공할 것
3. 아래 형식을 반드시 지킬 것

[응답 형식]
[정답 해설]
- 정답 선택 이유를 2~3문단으로 설명
- 필요한 계산이나 법령을 단계별로 제시

[오답 분석]
- 다른 선택지가 틀린 이유를 bullet 3개 이하로 정리

[암기 포인트]
- 유사 문제 대비 핵심 암기 포인트를 bullet 2개 이하로 정리

위 형식을 그대로 사용하여 자연스러운 한국어로 답변하세요.
`;

        if (isOpenAiModel(modelName)) {
          const openai = createOpenAiClient();
          const completion = await openai.chat.completions.create({
            model: modelName,
            messages: [
              {
                role: 'system',
                content: 'You are a professional tutor for Korean certification exams. Always respond in natural Korean with confident, well-structured explanations.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 900
          });
          result = completion.choices[0]?.message?.content || '';
          break;
        }

        const geminiModel = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: `
You are a professional tutor for Korean certification exams.
Always respond in natural Korean with confident, well-structured explanations.`,
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 900
          }
        });

        const response = await geminiModel.generateContent({
          contents: [
            { role: 'user', parts: [{ text: prompt }] }
          ]
        });
        result = response.response.text();
        break;
      }

      case 'explanationFollowUp': {
        const { question, messages, model } = payload;
        const modelName = model || DEFAULT_GEMINI_MODEL;
        if (!question || !Array.isArray(question.options)) {
          throw new Error('Invalid question payload for explanation follow-up');
        }
        if (!Array.isArray(messages) || messages.length === 0) {
          throw new Error('Follow-up messages are required');
        }

        const optionList = question.options
          .map((option: string, index: number) => `${String.fromCharCode(65 + index)}. ${option}`)
          .join('\n');

        const conversation = messages.map((msg: { role: string; content: string }) => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        }));

        const contextPrompt = `
[문제 요약]
자격증: ${question.certification || '미지정'}
과목: ${question.subject || '미지정'}
문제: ${question.questionText}

[선택지]
${optionList}

[정답 정보]
${typeof question.answerIndex === 'number'
            ? `정답 선택지: ${String.fromCharCode(65 + question.answerIndex)} (${question.options[question.answerIndex] || ''})`
            : '정답 미제공'}

이 대화는 위 문제를 학습하는 학생과의 후속 질문에 대한 답변입니다.
학생이 다른 주제로 벗어나려고 하면 다시 문제로 연결해 주세요.
`;

        if (isOpenAiModel(modelName)) {
          const openai = createOpenAiClient();
          const openAiMessages = [
            { role: 'user', content: contextPrompt },
            ...messages.map((msg: { role: string; content: string }) => ({
              role: msg.role === 'user' ? 'user' : 'assistant',
              content: msg.content
            }))
          ];
          const completion = await openai.chat.completions.create({
            model: modelName,
            messages: openAiMessages,
            temperature: 0.7,
            max_tokens: 800
          });
          result = completion.choices[0]?.message?.content || '';
          break;
        }

        const geminiModel = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800
          }
        });

        const response = await geminiModel.generateContent({
          contents: [
            { role: 'user', parts: [{ text: contextPrompt }] },
            ...conversation
          ]
        });
        result = response.response.text();
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ ok: true, data: result, warning }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Edge Function Error:', error);
    const mappedMessage = mapModelErrorMessage(error);
    // Return 200 with ok: false so client can read the JSON error body
    return new Response(JSON.stringify({
      ok: false,
      error: mappedMessage,
      stack: error.stack,
      details: "Error occurred in gemini-proxy Edge Function"
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
