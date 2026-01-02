export type LlmProvider = 'gemini' | 'openai';

export type LlmModelOption = {
    id: string;
    label: string;
    provider: LlmProvider;
    note?: string;
};

export const DEFAULT_LLM_MODEL = 'gemini-2.5-flash';
export const LLM_MODEL_STORAGE_KEY = 'jt-academy:llm-model';

export const AVAILABLE_LLM_MODELS: LlmModelOption[] = [
    {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash (default)',
        provider: 'gemini'
    },
    {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        provider: 'gemini'
    },
    {
        id: 'gemini-2.0-flash',
        label: 'Gemini 2.0 Flash',
        provider: 'gemini'
    },
    {
        id: 'gpt-4o-mini',
        label: 'OpenAI GPT-4o mini',
        provider: 'openai',
        note: 'text-first (image support varies)'
    },
    {
        id: 'gpt-4.1',
        label: 'OpenAI GPT-4.1',
        provider: 'openai'
    },
    {
        id: 'gpt-5.1',
        label: 'OpenAI GPT-5.1',
        provider: 'openai'
    },
    {
        id: 'gpt-5.2',
        label: 'OpenAI GPT-5.2',
        provider: 'openai'
    },
    {
        id: 'gpt-5.2-mini',
        label: 'OpenAI GPT-5.2 mini',
        provider: 'openai'
    }
];

export const getStoredLlmModel = (): string | undefined => {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage.getItem(LLM_MODEL_STORAGE_KEY) || undefined;
};

export const setStoredLlmModel = (value: string) => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LLM_MODEL_STORAGE_KEY, value);
};
