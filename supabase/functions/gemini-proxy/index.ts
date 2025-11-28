import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI } from "npm:@google/genai";

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

    const ai = new GoogleGenAI({ apiKey });
    const { action, payload } = await req.json();

    console.log(`Processing action: ${action}`);

    let result;

    switch (action) {
      case 'generateContent': {
        // Generic content generation
        const { model, prompt, schema } = payload;
        const config: any = {};
        if (schema) {
            config.responseMimeType = "application/json";
            config.responseSchema = schema;
        }
        
        const response = await ai.models.generateContent({
            model: model || "gemini-2.5-flash",
            contents: prompt,
            config
        });
        result = response.text;
        break;
      }

      case 'generateExplanation': {
        const { prompt } = payload;
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        });
        result = response.text;
        break;
      }

      case 'analyzeImage': {
        const { prompt, imageParts, schema } = payload;
        const contents = {
            parts: [{ text: prompt }, ...imageParts]
        };
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema,
            },
        });
        result = JSON.parse(response.text.trim());
        break;
      }
      
      case 'generateVariant': {
          const { prompt, schema } = payload;
          const response = await ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: prompt,
              config: {
                  responseMimeType: "application/json",
                  responseSchema: schema,
              },
          });
          result = JSON.parse(response.text.trim());
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
