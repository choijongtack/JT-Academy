import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import OpenAI from "npm:openai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    switch (action) {
      case 'generateContent': {
        // Generic content generation
        const { model, prompt, schema, imageParts } = payload;
        const modelName = model || "gemini-2.5-flash";
        const generationConfig: any = {};

        if (schema) {
          generationConfig.responseMimeType = "application/json";
          generationConfig.responseSchema = schema;
        }

        try {
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
          const openAiKey = Deno.env.get('OPENAI_API_KEY');
          if (!openAiKey) throw geminiError;

          console.warn('Gemini generateContent failed, falling back to OpenAI.');
          const openai = new OpenAI({ apiKey: openAiKey });
          const schemaNote = schema
            ? `\n\nJSON schema:\n${JSON.stringify(schema)}`
            : '';
          const systemPrompt = 'Return only valid JSON. Do not include any extra text.';
          const userPrompt = `${prompt}${schemaNote}`;

          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: "json_object" }
          });

          result = completion.choices[0]?.message?.content || '';
        }
        break;
      }

      case 'analyzeImage': {
        const { prompt, imageParts, schema } = payload;
        const generationConfig: any = {
          responseMimeType: "application/json",
          responseSchema: schema,
        };

        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig
        });

        const parts = [{ text: prompt }, ...imageParts];
        const response = await model.generateContent(parts);
        const text = response.response.text();

        // Robust cleaning of AI output (remove markdown backticks if present)
        const cleanJson = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
        result = JSON.parse(cleanJson);
        break;
      }

      case 'generateVariant': {
        const { prompt, schema } = payload;
        const generationConfig: any = {
          responseMimeType: "application/json",
          responseSchema: schema,
        };

        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig
        });

        const response = await model.generateContent(prompt);
        const text = response.response.text();

        // Robust cleaning
        const cleanJson = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
        result = JSON.parse(cleanJson);
        break;
      }

      case 'explanationChat': {
        const { question } = payload;
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

        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          systemInstruction: `
You are a professional tutor for Korean certification exams.
Always respond in natural Korean with confident, well-structured explanations.`,
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 900
          }
        });

        const response = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: prompt }] }
          ]
        });
        result = response.response.text();
        break;
      }

      case 'explanationFollowUp': {
        const { question, messages } = payload;
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

        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800
          }
        });

        const response = await model.generateContent({
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

    return new Response(JSON.stringify({ ok: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Edge Function Error:', error);
    // Return 200 with ok: false so client can read the JSON error body
    return new Response(JSON.stringify({
      ok: false,
      error: error.message,
      stack: error.stack,
      details: "Error occurred in gemini-proxy Edge Function"
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
