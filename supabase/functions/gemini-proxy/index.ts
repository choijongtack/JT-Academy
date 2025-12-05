import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    let result;

    switch (action) {
      case 'generateContent': {
        // Generic content generation
        const { model, prompt, schema, imageParts } = payload;
        const modelName = model || "gemini-2.0-flash-exp";
        const generationConfig: any = {};

        if (schema) {
          generationConfig.responseMimeType = "application/json";
          generationConfig.responseSchema = schema;
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
        break;
      }

      case 'generateExplanation': {
        const { prompt } = payload;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const response = await model.generateContent(prompt);
        result = response.response.text();
        break;
      }

      case 'analyzeImage': {
        const { prompt, imageParts, schema } = payload;
        const generationConfig: any = {
          responseMimeType: "application/json",
          responseSchema: schema,
        };

        const model = genAI.getGenerativeModel({
          model: "gemini-2.0-flash-exp",
          generationConfig
        });

        const parts = [{ text: prompt }, ...imageParts];
        const response = await model.generateContent(parts);
        const text = response.response.text();
        result = JSON.parse(text.trim());
        break;
      }

      case 'generateVariant': {
        const { prompt, schema } = payload;
        const generationConfig: any = {
          responseMimeType: "application/json",
          responseSchema: schema,
        };

        const model = genAI.getGenerativeModel({
          model: "gemini-2.0-flash-exp",
          generationConfig
        });

        const response = await model.generateContent(prompt);
        const text = response.response.text();
        result = JSON.parse(text.trim());
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
