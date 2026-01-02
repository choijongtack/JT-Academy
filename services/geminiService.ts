/// <reference types="vite/client" />

import { QuestionModel, AnalyzedQuestionResponse, GeneratedVariantProblem } from "../types";
import { SUBJECT_TOPICS, CERTIFICATION_SUBJECTS, TOPIC_KEYWORD_OVERRIDES } from "../constants";
import { supabase } from "./supabaseClient";
import { DEFAULT_LLM_MODEL, getStoredLlmModel } from "../utils/llmSettings";


// Helper to convert File -> base64
const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
};

const unwrapFunctionResponse = <T>(data: any, error: any, defaultMessage: string): T => {
    // 1. Handle HTTP/Invocation level errors from Supabase client
    if (error) {
        const message = (error as any)?.message || (error as any)?.error || defaultMessage;
        throw new Error(message);
    }

    // 2. Handle Logic level errors from our Edge Function
    if (data && typeof data === 'object' && 'ok' in data) {
        if (!data.ok) {
            const serverError = data.error || defaultMessage;
            const stack = data.stack ? `\nServer Stack: ${data.stack}` : '';
            console.error(`Edge Function Logic Error: ${serverError}${stack}`);
            throw new Error(serverError);
        }

        // Success case with 'ok' flag
        const payload = data.data;
        if (payload === undefined || payload === null) {
            throw new Error(defaultMessage);
        }
        return payload as T;
    }

    // 3. Fallback for old/direct responses
    if (data === undefined || data === null) {
        throw new Error(defaultMessage);
    }
    return data as T;
};

const normalizeTopicForSubject = (subject?: string, proposedTopic?: string): string => {
    const subjectTopics = subject ? SUBJECT_TOPICS[subject] : undefined;
    const fallback = '\uAE30\uD0C0';
    if (!subjectTopics || subjectTopics.length === 0) {
        return fallback;
    }

    const clean = (proposedTopic || '').replace(/\s+/g, '').toLowerCase();
    if (clean.length === 0) {
        return fallback;
    }

    const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();

    const exactMatch = subjectTopics.find(topic => normalize(topic) === clean);
    if (exactMatch) {
        return exactMatch;
    }

    const partialMatch = subjectTopics.find(topic => {
        const normalizedTopic = normalize(topic);
        return normalizedTopic.includes(clean) || clean.includes(normalizedTopic);
    });
    if (partialMatch) {
        return partialMatch;
    }

    return fallback;
};

const normalizeDifficulty = (value?: string): '\uC0C1' | '\uC911' | '\uD558' => {
    const high = '\uC0C1';
    const mid = '\uC911';
    const low = '\uD558';
    const raw = (value ?? '').toString().trim().toLowerCase();
    if (!raw) return mid;
    if (raw.includes(high) || raw === 'high' || raw === 'hard') return high;
    if (raw.includes(low) || raw === 'low' || raw === 'easy') return low;
    if (raw.includes(mid) || raw === 'medium') return mid;
    return mid;
};

const normalizeForComparison = (value: string) => value.replace(/\s+/g, '').toLowerCase();

const getOverrideCandidates = (question: QuestionModel) => {
    const normalizedSubject = question.subject ? normalizeForComparison(question.subject) : null;
    const candidates: Record<string, string[]>[] = [];

    const matchSubject = (subjectMap?: Record<string, Record<string, string[]>> | undefined) => {
        if (!subjectMap || !normalizedSubject) return null;
        const entry = Object.entries(subjectMap).find(([subjectName]) => normalizeForComparison(subjectName) === normalizedSubject);
        return entry ? entry[1] : null;
    };

    const pushAllSubjects = (subjectMap?: Record<string, Record<string, string[]>> | undefined) => {
        if (!subjectMap) return;
        Object.values(subjectMap).forEach(map => candidates.push(map));
    };

    let hasSubjectMatch = false;

    if (question.certification) {
        const certMap = TOPIC_KEYWORD_OVERRIDES[question.certification as keyof typeof TOPIC_KEYWORD_OVERRIDES];
        const matched = matchSubject(certMap);
        if (matched) {
            candidates.push(matched);
            hasSubjectMatch = true;
        } else {
            pushAllSubjects(certMap);
        }
    }

    if (!hasSubjectMatch) {
        const allCertMaps = Object.values(TOPIC_KEYWORD_OVERRIDES);
        if (normalizedSubject) {
            allCertMaps.forEach(certMap => {
                const matched = matchSubject(certMap);
                if (matched) {
                    candidates.push(matched);
                    hasSubjectMatch = true;
                }
            });
        }
        if (!hasSubjectMatch) {
            allCertMaps.forEach(certMap => pushAllSubjects(certMap));
        }
    }

    return candidates;
};

const detectTopicOverride = (question: QuestionModel): string | null => {
    if (!question) return null;
    const textParts: string[] = [];
    if (question.questionText) textParts.push(question.questionText);
    if (Array.isArray(question.options)) textParts.push(...question.options.filter(Boolean));
    if (question.aiExplanation) textParts.push(question.aiExplanation);
    if (question.hint) textParts.push(question.hint);
    if (question.rationale) textParts.push(question.rationale);

    const normalizedHaystack = normalizeForComparison(textParts.join(' '));
    if (!normalizedHaystack) return null;

    const candidateMaps = getOverrideCandidates(question);
    for (const topicMap of candidateMaps) {
        for (const [topic, keywords] of Object.entries(topicMap)) {
            for (const keyword of keywords) {
                const normalizedKeyword = normalizeForComparison(keyword);
                if (normalizedKeyword && normalizedHaystack.includes(normalizedKeyword)) {
                    return topic;
                }
            }
        }
    }
    return null;
};

const resolveTopicCategory = (question: QuestionModel, candidateTopic?: string | null): string => {
    const override = detectTopicOverride(question);
    const topicToNormalize = override || candidateTopic || undefined;
    return normalizeTopicForSubject(question.subject, topicToNormalize);
};

const resolveSelectedModel = () => getStoredLlmModel() || DEFAULT_LLM_MODEL;

const withSelectedModel = <T extends Record<string, any>>(payload: T) => ({
    ...payload,
    model: resolveSelectedModel()
});

export interface ExplanationChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export const sendExplanationFollowUpMessage = async (
    question: QuestionModel,
    messages: ExplanationChatMessage[]
): Promise<string> => {
    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'explanationFollowUp',
                payload: {
                    certification: question.certification,
                    question,
                    messages,
                    model: resolveSelectedModel()
                }
            }
        });

        const payload = unwrapFunctionResponse<string | unknown>(data, error, 'AI 해설 답변이 비어 있습니다.');
        return typeof payload === 'string' ? payload : JSON.stringify(payload);
    } catch (error) {
        console.error("Error sending explanation chat message:", error);
        throw new Error("AI 해설 채팅 답변을 가져오지 못했습니다. 다시 시도해 주세요.");
    }
};

export const analyzeQuestionFromImage = async (imageFile: File, questionNumber: string): Promise<AnalyzedQuestionResponse> => {
    const imagePart = await fileToGenerativePart(imageFile);

    const schema = {
        type: "OBJECT",
        properties: {
            target_question_number: { type: "STRING" },
            original_analysis: {
                type: "OBJECT",
                properties: {
                    subject: { type: "STRING" },
                    topic: { type: "STRING" },
                    key_formula: { type: "STRING" },
                },
                required: ["subject", "topic", "key_formula"]
            },
        },
        required: ["target_question_number", "original_analysis"]
    };

    const prompt = `
        You are a professional tutor and AI question analyzer for the 'Electrical Engineer Certification Exam' in Korea.
        Analyze the provided image of an exam paper.

        1. Identify Question: Find question number ${questionNumber || 'auto'}.
        2. Analyze: Determine the engineering principle, key formula, and topic for this question.
        3. Format Output:
           - All formulas must be in LaTeX with '$...$'.
           - Output must be a strict JSON object matching the schema.
    `;
    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'analyzeImage',
                payload: {
                    prompt,
                    imageParts: [imagePart],
                    schema,
                    model: resolveSelectedModel()
                }
            }
        });

        return unwrapFunctionResponse<AnalyzedQuestionResponse>(data, error, 'Failed to analyze the question.');

    } catch (error) {
        console.error("Error analyzing question:", error);
        throw new Error("Failed to analyze the question. The image might be unclear or the model could not process the request.");
    }
};

export const generateVariantQuestion = async (question: QuestionModel): Promise<GeneratedVariantProblem> => {
    const schema = {
        type: "OBJECT",
        properties: {
            question_text: { type: "STRING" },
            options: {
                type: "ARRAY",
                items: { type: "STRING" },
            },
            correct_answer_index: { type: "INTEGER" },
            explanation: { type: "STRING" },
        },
        required: ["question_text", "options", "correct_answer_index", "explanation"]
    };

    const prompt = `
        You are a professional tutor and AI question generator for the 'Electrical Engineer Certification Exam' in Korea.
        Analyze the provided original question and generate a new, similar variant question.

        Original:
        - Subject: ${question.subject}
        - Question: ${question.questionText}
        - Options: ${JSON.stringify(question.options)}
        - Correct Answer: ${question.options[question.answerIndex]}

        Instructions:
        - Output MUST be in Korean.
        - Keep the same core concept and difficulty.
        - Provide 4 options with exactly one correct answer.
        - Provide a step-by-step explanation for the new question.
        - Output must be a strict JSON object matching the schema.
    `;
    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateVariant',
                payload: withSelectedModel({ prompt, schema })
            }
        });

        return unwrapFunctionResponse<GeneratedVariantProblem>(data, error, 'Failed to generate a variant question.');

    } catch (error) {
        console.error("Error generating variant question:", error);
        throw new Error("Failed to generate a variant question. Please try again.");
    }
};

export const analyzeQuestionsFromText = async (text: string): Promise<QuestionModel[]> => {
    const startedAt = Date.now();
    const textLength = text.length;
    const schema = {
        type: "ARRAY",
        items: {
            type: "OBJECT",
            properties: {
                subject: { type: "STRING" },
                year: { type: "INTEGER" },
                questionText: { type: "STRING" },
                options: { type: "ARRAY", items: { type: "STRING" } },
                answerIndex: { type: "INTEGER", nullable: true },
                aiExplanation: { type: "STRING", nullable: true },
                hint: { type: "STRING" },
                rationale: { type: "STRING", nullable: true },
                topicCategory: { type: "STRING" },
                topicKeywords: { type: "ARRAY", items: { type: "STRING" } },
                difficultyLevel: { type: "STRING" },
                needsManualDiagram: { type: "BOOLEAN" }
            },
            required: ["subject", "questionText", "options", "topicCategory", "topicKeywords"]
        }
    };

    // Get all valid topics for context
    const validTopics = Object.values(SUBJECT_TOPICS).flat();
    const validTopicsString = JSON.stringify(validTopics);

    const prompt = `
        You are an expert exam parser.
        Extract multiple-choice questions from the provided text of an Electrical Engineer Certification Exam.

        Instructions:
        1. Language: output in Korean.
        2. Identify individual questions.
        3. Extract subject, question text, options, and correct answer.
        4. Preserve the original leading question number (e.g., "2. ...").
        5. If the source text includes "[그림 있음]", keep that tag inside questionText.
        6. If a diagram is required, set needsManualDiagram=true and leave answer/explanation/rationale as null.
        7. Provide topicCategory/topicKeywords/difficultyLevel for every question.
        8. Return a JSON array of QuestionModel objects.

        Text to Analyze:
        ${text.substring(0, 30000)}
    `;
    try {
        console.log(`[geminiService] analyzeQuestionsFromText: length=${textLength}`);
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateContent',
                payload: withSelectedModel({ prompt, schema })
            }
        });

        const payload = unwrapFunctionResponse<string | unknown>(data, error, 'Failed to extract questions from text.');
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const tryParse = (value: string): QuestionModel[] => JSON.parse(value) as QuestionModel[];
        let parsed: QuestionModel[];
        try {
            parsed = tryParse(serialized);
        } catch (parseError) {
            const cleaned = serialized
                .replace(/```json/g, '')
                .replace(/```/g, '')
                .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
                .trim();
            parsed = tryParse(cleaned);
        }
        return parsed.map(question => ({
            ...question,
            difficultyLevel: normalizeDifficulty(question.difficultyLevel)
        }));
    } catch (error) {
        console.error("Error analyzing text:", error);
        throw new Error("Failed to extract questions from text.");
    } finally {
        const elapsedMs = Date.now() - startedAt;
        console.log(`[geminiService] analyzeQuestionsFromText: completed in ${elapsedMs}ms`);
    }
};

const ELECTRICAL_ENGINEER_SUBJECTS = CERTIFICATION_SUBJECTS['\uC804\uAE30\uAE30\uC0AC'];

const normalizeSubjectName = (subject?: string, allowedSubjects?: string[], fallback?: string): string | undefined => {
    if (!allowedSubjects || allowedSubjects.length === 0) {
        return subject || fallback;
    }

    const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
    const normalizedValue = subject ? normalize(subject) : '';

    if (normalizedValue) {
        const exactMatch = allowedSubjects.find(s => normalize(s) === normalizedValue);
        if (exactMatch) {
            return exactMatch;
        }

        const partialMatch = allowedSubjects.find(s => {
            const normalizedAllowed = normalize(s);
            return normalizedAllowed.includes(normalizedValue) || normalizedValue.includes(normalizedAllowed);
        });
        if (partialMatch) {
            return partialMatch;
        }
    }

    if (fallback && allowedSubjects.includes(fallback)) {
        return fallback;
    }

    return allowedSubjects[0];
};

const isElectricalEngineerSubjectSet = (allowedSubjects?: string[]): boolean => {
    if (!allowedSubjects) return true;
    if (allowedSubjects.length !== ELECTRICAL_ENGINEER_SUBJECTS.length) return false;
    return ELECTRICAL_ENGINEER_SUBJECTS.every((subject, idx) => allowedSubjects[idx] === subject);
};

export const analyzeQuestionsFromImages = async (images: string[], subjectHint?: string, allowedSubjects?: string[]): Promise<QuestionModel[]> => {
    const schema = {
        type: "ARRAY",
        items: {
            type: "OBJECT",
            properties: {
                subject: { type: "STRING" },
                year: { type: "INTEGER" },
                questionText: { type: "STRING" },
                options: { type: "ARRAY", items: { type: "STRING" } },
                answerIndex: { type: "INTEGER" },
                aiExplanation: { type: "STRING", nullable: true },
                hint: { type: "STRING" },
                rationale: { type: "STRING", nullable: true },
                topicCategory: { type: "STRING" },
                topicKeywords: { type: "ARRAY", items: { type: "STRING" } },
                needsManualDiagram: { type: "BOOLEAN" },
                diagramBounds: {
                    type: "OBJECT",
                    properties: {
                        x: { type: "NUMBER" },
                        y: { type: "NUMBER" },
                        width: { type: "NUMBER" },
                        height: { type: "NUMBER" }
                    }
                },
                diagram_info: {
                    type: "OBJECT",
                    properties: {
                        extracted_values: { type: "ARRAY", items: { type: "STRING" } },
                        connections: { type: "ARRAY", items: { type: "STRING" } },
                        axes: {
                            type: "OBJECT",
                            properties: {
                                x_label: { type: "STRING" },
                                x_unit: { type: "STRING" },
                                y_label: { type: "STRING" },
                                y_unit: { type: "STRING" },
                                scale: { type: "STRING" },
                                x_ticks: { type: "ARRAY", items: { type: "STRING" } },
                                y_ticks: { type: "ARRAY", items: { type: "STRING" } },
                                legend: { type: "ARRAY", items: { type: "STRING" } },
                                table_headers: { type: "ARRAY", items: { type: "STRING" } }
                            },
                            nullable: true
                        },
                        sample_points: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                        table_entries: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                        description: { type: "STRING" },
                        topology: { type: "STRING" }
                    },
                    nullable: true
                }
            },
            required: ["subject", "questionText", "options", "topicCategory", "topicKeywords"]
        }
    };

    // Get all valid topics for context
    const validTopics = Object.values(SUBJECT_TOPICS).flat();
    const validTopicsString = JSON.stringify(validTopics);

    const prompt = `
        You are an expert exam parser for Electrical Engineering in Korea.
        Analyze the provided images of exam papers and extract multiple-choice questions.

        Instructions:
        1. Output MUST be in Korean.
        2. Transcribe question text and options exactly as shown.
        3. Start questionText with the question number (e.g., "1. ...").
        4. If a diagram/chart/graph is present, set needsManualDiagram=true and include diagramBounds.
        5. Provide topicCategory and topicKeywords.
        6. Return a JSON array of QuestionModel objects.
    `;
    // Prepare image parts
    const imageParts = images.map(base64Data => {
        const mimeMatch = base64Data.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
        return {
            inlineData: {
                data: cleanBase64,
                mimeType: mimeType
            }
        };
    });

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'analyzeImage',
                payload: {
                    prompt,
                    imageParts,
                    schema,
                    model: resolveSelectedModel()
                }
            }
        });

        const questions = unwrapFunctionResponse<QuestionModel[]>(data, error, 'Failed to extract questions from images.');
        const enforceNumberRule = isElectricalEngineerSubjectSet(allowedSubjects);

        // Post-processing: Enforce subject rules and STRICT diagram filtering
        return questions.map(q => {
            let processedQ = { ...q };
            let match: RegExpMatchArray | null = null;

            // 1. Enforce Subject Rules (only for 전기기사 기본 파트)
            if (enforceNumberRule) {
                match = processedQ.questionText.match(/^(\d+)\./);
                if (match) {
                    const questionNumber = parseInt(match[1], 10);
                    const determinedSubject = determineSubjectByNumber(questionNumber);

                    if (determinedSubject) {
                        console.log(`[Rule-Based] Question ${questionNumber}: Overriding subject '${processedQ.subject}' -> '${determinedSubject}'`);
                        processedQ.subject = determinedSubject;
                    }
                }
            }

            const normalizedSubject = normalizeSubjectName(processedQ.subject, allowedSubjects, subjectHint);
            if (normalizedSubject) {
                processedQ.subject = normalizedSubject;
            }

            processedQ.topicCategory = resolveTopicCategory(processedQ, processedQ.topicCategory);

            // 2. STRICT Diagram Filtering
            const diagramKeywords = ["그림", "다음 그림", "아래 그림", "회로도", "결선도"];
            const hasKeyword = diagramKeywords.some(keyword => processedQ.questionText.includes(keyword));

            if (processedQ.diagramBounds && !hasKeyword) {
                console.log(`[Rule-Based] Question ${match ? match[1] : 'unknown'}: Removed false positive diagram (No keywords found).`);
                processedQ.diagramBounds = undefined;
            }
            if (!processedQ.diagramBounds && hasKeyword) {
                processedQ.needsManualDiagram = true;
            }


            // 3. Add diagram indicator to questionText if diagramBounds exists
            if (processedQ.diagramBounds && !processedQ.questionText.includes('[다이어그램]')) {
                // Insert diagram indicator after question number
                if (match) {
                    // Format: "1. [다이어그램] 다음 문제.."
                    processedQ.questionText = processedQ.questionText.replace(
                        /^(\d+\.\s*)/,
                        '$1[다이어그램] '
                    );
                } else {
                    // No question number, prepend to text
                    processedQ.questionText = '[다이어그램] ' + processedQ.questionText;
                }
            }

            return {
                ...processedQ,
                difficultyLevel: normalizeDifficulty(processedQ.difficultyLevel)
            };
        });

    } catch (error) {
        console.error("Error analyzing images:", error);
        throw new Error(`Failed to extract questions from images: ${error instanceof Error ? error.message : String(error)}`);
    }
};

export const solveQuestionWithDiagram = async (
    question: QuestionModel,
    diagramImageBase64: string
): Promise<{ result: Partial<QuestionModel>; warning?: string }> => {
    // Clean base64 string if it contains data URL prefix
    const cleanBase64 = diagramImageBase64.includes('base64,')
        ? diagramImageBase64.split('base64,')[1]
        : diagramImageBase64;

    const imagePart = {
        inlineData: {
            data: cleanBase64,
            mimeType: "image/jpeg"
        }
    };

    const schema = {
        type: "OBJECT",
        properties: {
            answerIndex: { type: "INTEGER" },
            aiExplanation: { type: "STRING" },
            rationale: { type: "STRING" },
            diagram_info: {
                type: "OBJECT",
                properties: {
                    extracted_values: { type: "ARRAY", items: { type: "STRING" } },
                    connections: { type: "ARRAY", items: { type: "STRING" } },
                    axes: {
                        type: "OBJECT",
                        properties: {
                            x_label: { type: "STRING" },
                            x_unit: { type: "STRING" },
                            y_label: { type: "STRING" },
                            y_unit: { type: "STRING" },
                            scale: { type: "STRING" },
                            x_ticks: { type: "ARRAY", items: { type: "STRING" } },
                            y_ticks: { type: "ARRAY", items: { type: "STRING" } },
                            legend: { type: "ARRAY", items: { type: "STRING" } },
                            table_headers: { type: "ARRAY", items: { type: "STRING" } }
                        },
                        nullable: true
                    },
                    sample_points: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                    table_entries: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                    description: { type: "STRING" },
                    topology: { type: "STRING" }
                },
                required: ["extracted_values", "connections", "description", "topology"]
            }
        },
        required: ["answerIndex", "aiExplanation", "rationale", "diagram_info"]
    };

    const prompt = `
        You are a professional Electrical Engineering tutor.
        The user has provided a question text and its accompanying diagram/image.

        Task:
        1. Analyze the diagram and extract values/connections/axes into diagram_info.
        2. Solve the question using the diagram and text.

        Question Context:
        - Subject: ${question.subject}
        - Text: ${question.questionText}
        - Options: ${JSON.stringify(question.options)}

        Output:
        - Language: Korean.
        - Math: Use LaTeX with '$...$'.
        - Output must be strict JSON matching the schema.
    `;
    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'analyzeImage',
                payload: {
                    prompt,
                    imageParts: [imagePart],
                    schema,
                    model: resolveSelectedModel()
                }
            }
        });

        const warning = data && typeof data === 'object' && 'warning' in data ? (data as any).warning as string | undefined : undefined;
        const result = unwrapFunctionResponse<Partial<QuestionModel>>(data, error, 'Failed to solve question with diagram.');
        return { result, warning };
    } catch (error) {
        console.error("Error solving question with diagram:", error);
        throw new Error("Failed to re-analyze the question with the provided diagram.");
    }
};

/**
 * Analyzes a document file (like .docx) for question extraction.
 */
export const analyzeDocument = async (
    file: File,
    allowedSubjects: string[] = [],
    subjectHint?: string,
    questionStart?: number,
    questionEnd?: number
): Promise<QuestionModel[]> => {
    const schema = {
        type: "ARRAY",
        items: {
            type: "OBJECT",
            properties: {
                subject: { type: "STRING" },
                questionText: { type: "STRING" },
                options: { type: "ARRAY", items: { type: "STRING" } },
                answerIndex: { type: "INTEGER" },
                aiExplanation: { type: "STRING" },
                hint: { type: "STRING" },
                rationale: { type: "STRING" },
                topicCategory: { type: "STRING" },
                topicKeywords: { type: "ARRAY", items: { type: "STRING" } },
                needsManualDiagram: { type: "BOOLEAN" }
            },
            required: ["subject", "questionText", "options", "answerIndex", "aiExplanation"]
        }
    };

    const prompt = `
        You are an expert exam parser for Electrical Engineering in Korea.
        ${questionStart && questionEnd ? `Analyze the provided document and extract questions numbered from ${questionStart} to ${questionEnd}.` : 'Analyze the provided document and extract ALL multiple-choice questions.'}

        Instructions:
        1. Transcribe the question text and options exactly.
        2. Output in Korean.
        3. If a diagram is present, set needsManualDiagram to true.
        4. Identify the subject (prefer "${subjectHint ?? ''}" if applicable).
        5. Return a JSON array of QuestionModel objects.
    `;
    // Convert file to base64 for Gemini
    const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    // Force standard MIME types for certain extensions to ensure Gemini compatibility.
    let mimeType = file.type;
    if (file.name.toLowerCase().endsWith('.docx')) {
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (file.name.toLowerCase().endsWith('.txt')) {
        mimeType = 'text/plain';
    }

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'analyzeImage', // Highly stable action that handles server-side cleaning & parsing
                payload: {
                    prompt,
                    schema,
                    model: resolveSelectedModel(),
                    imageParts: [
                        {
                            inlineData: {
                                data: base64Data,
                                mimeType: mimeType
                            }
                        }
                    ]
                }
            }
        });

        const questions = unwrapFunctionResponse<QuestionModel[]>(data, error, 'Failed to extract questions from document.');

        // Post-processing
        return questions.map(q => {
            let processedQ = { ...q };
            const normalizedSubject = normalizeSubjectName(processedQ.subject, allowedSubjects, subjectHint);
            if (normalizedSubject) processedQ.subject = normalizedSubject;
            processedQ.topicCategory = resolveTopicCategory(processedQ, processedQ.topicCategory);
            return {
                ...processedQ,
                difficultyLevel: normalizeDifficulty(processedQ.difficultyLevel)
            };
        });
    } catch (error) {
        console.error("Error analyzing document:", error);
        throw new Error(`Failed to extract questions from document: ${error instanceof Error ? error.message : String(error)}`);
    }
};

/**
 * Determines the subject based on the question number.
 */
function determineSubjectByNumber(number: number): string | null {
    if (number >= 1 && number <= 20) return '\uC804\uAE30\uC790\uAE30\uD559';
    if (number >= 21 && number <= 40) return '\uC804\uB825\uACF5\uD559';
    if (number >= 41 && number <= 60) return '\uC804\uAE30\uAE30\uAE30';
    if (number >= 61 && number <= 80) return '\uD68C\uB85C\uC774\uB860 \uBC0F \uC81C\uC5B4\uACF5\uD559';
    if (number >= 81 && number <= 100) return '\uC804\uAE30\uC124\uBE44\uAE30\uC220\uAE30\uC900 \uBC0F \uD310\uB2E8\uAE30\uC900';
    return null;
}

export interface AnswerSheetEntry {
    question_number: number;
    answer: string;
}

export const parseAnswerSheetFromImage = async (imageFile: File): Promise<AnswerSheetEntry[]> => {
    const imagePart = await fileToGenerativePart(imageFile);

    const schema = {
        type: "ARRAY",
        items: {
            type: "OBJECT",
            properties: {
                question_number: { type: "INTEGER" },
                answer: { type: "STRING" }
            },
            required: ["question_number", "answer"]
        }
    };

    const prompt = `
        You are extracting official answer keys from a Korean certification exam answer sheet image.
        Read all question numbers and their answers.

        **Rules:**
        1. Output ONLY JSON matching the schema.
        2. 'answer' MUST be one of: "\uAC00", "\uB098", "\uB2E4", "\uB77C".
        3. Include every question number you can see.
        4. If multiple subjects are present, continue numbering as shown (e.g., 1-100).
    `;

    const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: {
            action: 'analyzeImage',
            payload: {
                prompt,
                imageParts: [imagePart],
                schema,
                model: DEFAULT_LLM_MODEL
            }
        }
    });

    return unwrapFunctionResponse<AnswerSheetEntry[]>(data, error, 'Failed to parse answer sheet.');
};

export const solveQuestionFromText = async (
    question: QuestionModel
): Promise<Pick<QuestionModel, 'answerIndex' | 'aiExplanation' | 'rationale'>> => {
    const schema = {
        type: "OBJECT",
        properties: {
            answerIndex: { type: "INTEGER" },
            aiExplanation: { type: "STRING" },
            rationale: { type: "STRING" }
        },
        required: ["answerIndex", "aiExplanation", "rationale"]
    };

    const prompt = `
        You are a professional Electrical Engineering tutor.
        Solve the following multiple-choice question.

        **Question**
        ${question.questionText}

        **Options**
        ${JSON.stringify(question.options)}

        **Instructions**
        - Return the correct answer index (0-3).
        - Provide a concise explanation and rationale in Korean.
        - Output ONLY a strict JSON object that matches the schema.
    `;

    const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: {
            action: 'generateContent',
            payload: withSelectedModel({ prompt, schema })
        }
    });

    return unwrapFunctionResponse<Pick<QuestionModel, 'answerIndex' | 'aiExplanation' | 'rationale'>>(
        data,
        error,
        'Failed to solve question from text.'
    );
};

export const generateExplanationForAnswer = async (
    question: QuestionModel,
    answerIndex: number,
    diagramImageBase64?: string
): Promise<{
    aiExplanation: string;
    hint: string;
    rationale: string;
    diagram_info?: QuestionModel['diagram_info'];
}> => {
    const schema = {
        type: "OBJECT",
        properties: {
            aiExplanation: { type: "STRING" },
            hint: { type: "STRING" },
            rationale: { type: "STRING" },
            diagram_info: {
                type: "OBJECT",
                properties: {
                    extracted_values: { type: "ARRAY", items: { type: "STRING" } },
                    connections: { type: "ARRAY", items: { type: "STRING" } },
                    axes: {
                        type: "OBJECT",
                        properties: {
                            x_label: { type: "STRING" },
                            x_unit: { type: "STRING" },
                            y_label: { type: "STRING" },
                            y_unit: { type: "STRING" },
                            scale: { type: "STRING" },
                            x_ticks: { type: "ARRAY", items: { type: "STRING" } },
                            y_ticks: { type: "ARRAY", items: { type: "STRING" } },
                            legend: { type: "ARRAY", items: { type: "STRING" } },
                            table_headers: { type: "ARRAY", items: { type: "STRING" } }
                        },
                        nullable: true
                    },
                    sample_points: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                    table_entries: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                    description: { type: "STRING" },
                    topology: { type: "STRING" }
                },
                required: ["extracted_values", "connections", "description", "topology"]
            }
        },
        required: ["aiExplanation", "hint", "rationale"]
    };

    const correctOption = Array.isArray(question.options) ? question.options[answerIndex] : undefined;
    const prompt = `
        You are a professional Electrical Engineering tutor.
        The correct answer is fixed by the official answer sheet.

        Question:
        ${question.questionText}

        Options:
        ${JSON.stringify(question.options)}

        Official correct answer:
        - Index: ${answerIndex}
        - Option: ${correctOption ?? ''}

        Instructions:
        1. Explain why this answer is correct, and why the others are wrong.
        2. Provide a concise hint in Korean.
        3. If a diagram image is provided, incorporate it and extract diagram_info.
        4. Output ONLY a strict JSON object matching the schema.
    `;

    const requestExplanation = async (modelName: string) => {
        if (diagramImageBase64) {
            const cleanBase64 = diagramImageBase64.includes('base64,')
                ? diagramImageBase64.split('base64,')[1]
                : diagramImageBase64;
            const imagePart = {
                inlineData: {
                    data: cleanBase64,
                    mimeType: "image/jpeg"
                }
            };
            const { data, error } = await supabase.functions.invoke('gemini-proxy', {
                body: {
                    action: 'analyzeImage',
                    payload: {
                        prompt,
                        imageParts: [imagePart],
                        schema,
                        model: modelName
                    }
                }
            });
            return unwrapFunctionResponse<{
                aiExplanation: string;
                hint: string;
                rationale: string;
                diagram_info?: QuestionModel['diagram_info'];
            }>(data, error, 'Failed to generate explanation with diagram.');
        }

        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateContent',
                payload: {
                    prompt,
                    schema,
                    model: modelName
                }
            }
        });
        return unwrapFunctionResponse<{
            aiExplanation: string;
            hint: string;
            rationale: string;
            diagram_info?: QuestionModel['diagram_info'];
        }>(data, error, 'Failed to generate explanation for answer.');
    };

    const isEmptyText = (value?: string | null) => !value || value.trim().length === 0;

    try {
        const primaryModel = resolveSelectedModel();
        let result = await requestExplanation(primaryModel);
        const shouldRetry = isEmptyText(result.aiExplanation) || isEmptyText(result.hint) || isEmptyText(result.rationale);
        if (shouldRetry && primaryModel !== DEFAULT_LLM_MODEL) {
            console.warn(`[generateExplanationForAnswer] Empty response detected. Retrying with ${DEFAULT_LLM_MODEL}.`);
            result = await requestExplanation(DEFAULT_LLM_MODEL);
        }
        return result;
    } catch (error) {
        console.error('generateExplanationForAnswer error:', error);
        return {
            aiExplanation: question.aiExplanation ?? '',
            hint: question.hint ?? '',
            rationale: question.rationale ?? '',
            diagram_info: question.diagram_info
        };
    }
};

export async function classifyQuestionTopic(
    question: QuestionModel
): Promise<{
    topicCategory: string;
    topicKeywords: string[];
    difficultyLevel: '\uC0C1' | '\uC911' | '\uD558';
}> {
    const overrideTopic = detectTopicOverride(question);
    if (overrideTopic) {
        const normalized = resolveTopicCategory(question, overrideTopic);
        return {
            topicCategory: normalized,
            topicKeywords: [overrideTopic],
            difficultyLevel: normalizeDifficulty(question.difficultyLevel)
        };
    }

    const validTopics = Object.values(SUBJECT_TOPICS).flat();
    const prompt = `
You are classifying the topic of a Korean electrical engineering exam question.

Return a JSON object:
{
  "topicCategory": "<best matching category>",
  "topicKeywords": ["keyword1", "keyword2", "keyword3"],
  "difficultyLevel": "\uC0C1 | \uC911 | \uD558"
}

Pick topicCategory from this list when possible:
${JSON.stringify(validTopics)}

Question:
${question.questionText}

Options:
${Array.isArray(question.options) ? question.options.join(' / ') : ''}
`;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateContent',
                payload: withSelectedModel({
                    prompt,
                    schema: {
                        type: "OBJECT",
                        properties: {
                            topicCategory: { type: "STRING" },
                            topicKeywords: { type: "ARRAY", items: { type: "STRING" } },
                            difficultyLevel: { type: "STRING" }
                        }
                    }
                })
            }
        });

        const payload = unwrapFunctionResponse<string | unknown>(data, error, 'Failed to classify question topic.');
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanText);

        const normalizedTopic = resolveTopicCategory(question, parsed.topicCategory);
        return {
            topicCategory: normalizedTopic,
            topicKeywords: Array.isArray(parsed.topicKeywords) ? parsed.topicKeywords : [],
            difficultyLevel: normalizeDifficulty(parsed.difficultyLevel)
        };
    } catch (error) {
        console.error('Topic classification error:', error);
        return {
            topicCategory: resolveTopicCategory(question),
            topicKeywords: question.topicKeywords ?? [],
            difficultyLevel: normalizeDifficulty(question.difficultyLevel)
        };
    }
}

const TOPIC_CLASSIFICATION_TIMEOUT_MS = 30000;
const TOPIC_CLASSIFICATION_CONCURRENCY = 3;

type TopicClassificationResult = Awaited<ReturnType<typeof classifyQuestionTopic>>;

const classifyQuestionTopicWithTimeout = (
    question: QuestionModel,
    timeoutMs: number = TOPIC_CLASSIFICATION_TIMEOUT_MS
): Promise<TopicClassificationResult> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Topic classification timeout'));
        }, timeoutMs);

        classifyQuestionTopic(question)
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
};

export async function batchClassifyTopics(
    questions: QuestionModel[]
): Promise<QuestionModel[]> {
    const classified: QuestionModel[] = [];
    const chunkSize = Math.max(1, TOPIC_CLASSIFICATION_CONCURRENCY);

    for (let i = 0; i < questions.length; i += chunkSize) {
        const chunk = questions.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
            chunk.map(question => classifyQuestionTopicWithTimeout(question))
        );

        results.forEach((result, index) => {
            const question = chunk[index];
            if (result.status === 'fulfilled') {
                classified.push({
                    ...question,
                    ...result.value
                });
            } else {
                classified.push({
                    ...question,
                    topicCategory: resolveTopicCategory(question),
                    topicKeywords: question.topicKeywords ?? [],
                    difficultyLevel: normalizeDifficulty(question.difficultyLevel)
                });
            }
        });
    }

    return classified;
}

export const generateQuestionDetails = async (
    question: QuestionModel
): Promise<Pick<QuestionModel, 'aiExplanation' | 'hint' | 'rationale'>> => {
    const schema = {
        type: "OBJECT",
        properties: {
            aiExplanation: { type: "STRING" },
            hint: { type: "STRING" },
            rationale: { type: "STRING" }
        },
        required: ["aiExplanation", "hint", "rationale"]
    };

    const prompt = `
You are a professional tutor for the Korean electrical engineering exam.
Write a concise explanation, hint, and rationale for the following question.

Question:
${question.questionText}

Options:
${Array.isArray(question.options) ? question.options.join(' / ') : ''}

Instructions:
- Provide a short explanation (aiExplanation) in Korean.
- Provide a short hint in Korean.
- Provide a rationale explaining why the correct answer is right and others are wrong.
- Output a strict JSON object matching the schema.
`;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateContent',
                payload: withSelectedModel({ prompt, schema })
            }
        });

        return unwrapFunctionResponse<{ aiExplanation: string; hint: string; rationale: string }>(
            data,
            error,
            'Failed to generate question details.'
        );
    } catch (err) {
        console.error('generateQuestionDetails error:', err);
        return {
            aiExplanation: question.aiExplanation ?? '',
            hint: question.hint ?? '',
            rationale: question.rationale ?? ''
        };
    }
};

export const extractTextFromImages = async (images: string[]): Promise<string> => {
    const prompt = `
You are an expert OCR system.
Extract ALL text from the provided images of documents.
Return ONLY the extracted text. Do not add any conversational filler.
If there are multiple images, separate them with "---PAGE BREAK---".
`;

    const imageParts = images.map(base64Data => {
        const mimeMatch = base64Data.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
        return {
            inlineData: {
                data: cleanBase64,
                mimeType
            }
        };
    });

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateContent',
                payload: withSelectedModel({ prompt, imageParts })
            }
        });

        const payload = unwrapFunctionResponse<string | unknown>(data, error, 'Failed to extract text from images.');
        return typeof payload === 'string' ? payload : JSON.stringify(payload);
    } catch (error) {
        console.error("Error extracting text:", error);
        throw new Error("Failed to extract text from images.");
    }
};

export const generateFiveVariants = async (
    originalQuestion: QuestionModel,
    examStandardsText?: string
): Promise<QuestionModel[]> => {
    const schema = {
        type: "ARRAY",
        items: {
            type: "OBJECT",
            properties: {
                questionText: { type: "STRING" },
                options: { type: "ARRAY", items: { type: "STRING" } },
                answerIndex: { type: "INTEGER" },
                aiExplanation: { type: "STRING" },
                hint: { type: "STRING" },
                rationale: { type: "STRING" }
            },
            required: ["questionText", "options", "answerIndex", "aiExplanation"]
        }
    };

    const standardsContext = examStandardsText
        ? `\n\nExam Standards Reference:\n${examStandardsText.substring(0, 3000)}\n\n`
        : '';

    const prompt = `
        You are an expert exam question generator for Korean certification exams.
        Generate EXACTLY 5 unique variant questions based on the original.
        ${standardsContext}
        Original Question:
        - Subject: ${originalQuestion.subject}
        - Question: ${originalQuestion.questionText}
        - Options: ${JSON.stringify(originalQuestion.options)}
        - Answer: ${originalQuestion.options[originalQuestion.answerIndex]}

        Requirements:
        1. Output MUST be in Korean.
        2. Keep the same subject and topic.
        3. Vary the numbers or scenario while keeping the core concept.
        4. Each variant has 4 options and 1 correct answer.
        5. Provide explanation and hint.
        6. Output a JSON array matching the schema.
    `;

    const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: {
            action: 'generateVariant',
            payload: withSelectedModel({ prompt, schema })
        }
    });

    const variants = unwrapFunctionResponse<any[]>(data, error, 'Failed to generate variant questions.');
    return variants.map((variant: any) => ({
        ...variant,
        id: 0,
        subject: originalQuestion.subject,
        year: originalQuestion.year,
        isVariant: true,
        parentQuestionId: originalQuestion.id,
        certification: originalQuestion.certification,
        topicCategory: originalQuestion.topicCategory,
        topicKeywords: originalQuestion.topicKeywords,
        difficultyLevel: originalQuestion.difficultyLevel
    }));
};


