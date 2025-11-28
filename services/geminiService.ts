/// <reference types="vite/client" />

import { QuestionModel, AnalyzedQuestionResponse, GeneratedVariantProblem } from "../types";
import { SUBJECT_TOPICS, CERTIFICATION_SUBJECTS } from "../constants";
import { supabase } from "./supabaseClient";
import { Type } from "@google/genai";

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

const normalizeTopicForSubject = (subject?: string, proposedTopic?: string): string => {
    const subjectTopics = subject ? SUBJECT_TOPICS[subject] : undefined;
    if (!subjectTopics || subjectTopics.length === 0) {
        return '기타';
    }

    const clean = (proposedTopic || '').replace(/\s+/g, '').toLowerCase();
    if (clean.length === 0) {
        return '기타';
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

    return '기타';
};

export const generateAIExplanation = async (question: QuestionModel): Promise<string> => {
    const prompt = `
        You are an expert tutor for electrical engineering certification exams in Korea.
        Explain the correct answer for the following multiple-choice question clearly and concisely in KOREAN.
        
        Structure your response as follows:
        1. **Correct Answer**: State the correct option and why it's correct.
        2. **Why Others are Wrong**: Briefly explain why the other options are incorrect.
        3. **Key Memorization Point (암기 포인트)**: Explicitly state the formulas, concepts, or values that must be memorized to solve this type of problem.

        Question: "${question.questionText}"
        Options:
        A: ${question.options[0]}
        B: ${question.options[1]}
        C: ${question.options[2]}
        D: ${question.options[3]}

        Correct Answer: ${question.options[question.answerIndex]}

        Provide your explanation in a way that is easy for a student to understand.
    `;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateExplanation',
                payload: { prompt }
            }
        });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error("Error generating AI explanation:", error);
        return "Sorry, I couldn't generate an explanation at this time. Please try again later.";
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

        1.  **Identify Question:** Find question number ${questionNumber || 'auto'}. If the number is not specified or unclear, find the most prominent question.
        2.  **Analyze:** Determine the engineering principle, key formula, and topic for this question.
        3.  **Format Output:**
            - All mathematical formulas and symbols MUST be in LaTeX format enclosed in '$' (e.g., $V = IR$, $\\epsilon_r$).
            - The final output MUST be a single, strict JSON object matching the provided schema. Do not include any text outside the JSON object.
    `;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'analyzeImage',
                payload: {
                    prompt,
                    imageParts: [imagePart],
                    schema
                }
            }
        });

        if (error) throw error;
        return data as AnalyzedQuestionResponse;

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
        Analyze the provided original question and generate a new, similar 'Variant Question'.

        **Original Question:**
        - **Subject:** ${question.subject}
        - **Question:** ${question.questionText}
        - **Options:** ${JSON.stringify(question.options)}
        - **Correct Answer:** ${question.options[question.answerIndex]}

        **Instructions:**
        1.  **Language**: ALL output MUST be in KOREAN (한국어).
        2.  **Analyze**: Understand the core engineering principle, topic, and formula of the original question.
        3.  **Generate Variant**:
            - Keep the same core concept and difficulty level.
            - Change numerical values, component specifications, or specific conditions.
            - Create four new multiple-choice options, including plausible distractors. Ensure there is only one correct answer.
            - Provide a detailed step-by-step explanation for the correct answer of the *new* variant question.
        4.  **Explanation Structure**:
            - **Solution**: Step-by-step calculation or reasoning.
            - **Key Memorization Point (암기 포인트)**: The core formula or concept needed.
        5.  **Format Output**:
            - All mathematical formulas and symbols MUST be in LaTeX format enclosed in '$' (e.g., $V = IR$, $\\epsilon_r$).
            - The final output MUST be a single, strict JSON object matching the provided schema. Do not include any text outside the JSON object.
    `;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateVariant',
                payload: { prompt, schema }
            }
        });

        if (error) throw error;
        return data as GeneratedVariantProblem;

    } catch (error) {
        console.error("Error generating variant question:", error);
        throw new Error("Failed to generate a variant question. Please try again.");
    }
};

export const analyzeQuestionsFromText = async (text: string): Promise<QuestionModel[]> => {
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
                aiExplanation: { type: "STRING" },
                hint: { type: "STRING" },
                rationale: { type: "STRING" },
            },
            required: ["subject", "questionText", "options", "answerIndex", "aiExplanation"]
        }
    };

    const prompt = `
        You are an expert exam parser.
        Extract multiple-choice questions from the provided text of an Electrical Engineer Certification Exam.
        
        **Instructions:**
        1. Identify individual questions.
        2. Extract the subject (e.g., 'Electric Circuits', 'Electromagnetics', etc.) based on the content.
        3. Extract the question text, options, and correct answer.
        4. If the correct answer is not explicitly marked, solve the question to find the correct answer index (0-3).
        5. Provide a brief explanation.
        6. **Hint**: Provide a short hint for solving the problem (optional).
        7. **Rationale**: Provide a detailed explanation of why the answer is correct and others are wrong.
        8. Set 'year' to the current year if not found in text.
        9. Return a JSON array of QuestionModel objects.
        
        **Text to Analyze:**
        ${text.substring(0, 30000)} 
    `;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateContent',
                payload: { prompt, schema }
            }
        });

        if (error) throw error;
        return JSON.parse(data) as QuestionModel[];
    } catch (error) {
        console.error("Error analyzing text:", error);
        throw new Error("Failed to extract questions from text.");
    }
};

const ELECTRICAL_ENGINEER_SUBJECTS = CERTIFICATION_SUBJECTS['전기기사'];

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
                aiExplanation: { type: "STRING" },
                hint: { type: "STRING" },
                rationale: { type: "STRING" },
                topicCategory: { type: "STRING" },
                topicKeywords: { type: "ARRAY", items: { type: "STRING" } },
                diagramBounds: {
                    type: "OBJECT",
                    properties: {
                        x: { type: "NUMBER" },
                        y: { type: "NUMBER" },
                        width: { type: "NUMBER" },
                        height: { type: "NUMBER" }
                    }
                }
            },
            required: ["subject", "questionText", "options", "answerIndex", "aiExplanation"]
        }
    };

    const prompt = `
        You are an expert exam parser for Electrical Engineering in Korea.
        Analyze the provided images of exam papers and extract multiple-choice questions.
        ${subjectHint ? `\n        **IMPORTANT**: The user has specified that these questions belong to the subject: "${subjectHint}". Please use this subject for all extracted questions unless it is clearly incorrect.\n` : ''}
        **Instructions:**
        1. **Language**: ALL output (Question, Options, Explanation, Subject) MUST be in KOREAN (한국어).
        2. **Transcription**: Transcribe the question text and options EXACTLY as they appear in the image. 
           - **IMPORTANT**: Start the 'questionText' with the question number followed by a period (e.g., "1. 다음 중..."). Do not omit the number.
           - Do not summarize or paraphrase.
        3. **Math & Formulas**: ALL mathematical formulas, symbols, and variables MUST be in LaTeX format enclosed in '$'.
           - **CRITICAL JSON FORMATTING**: You are outputting JSON. Therefore, ALL backslashes in LaTeX must be **DOUBLE ESCAPED** (e.g., use \`\\\\frac\` instead of \`\\frac\`, \`\\\\times\` instead of \`\\times\`).
           - Example: Write \`$ \\\\frac{\\\\partial B}{\\\\partial t} $\` (in JSON string it will look like \`"$\\\\frac{\\\\partial B}{\\\\partial t}$"\`).
           - Do not use Unicode for math (e.g., do not use '×', '÷', 'Ω', 'π' directly). Use LaTeX (e.g., \`\\\\times\`, \`\\\\div\`, \`\\\\Omega\`, \`\\\\pi\`).
           - Ensure fractions are properly formatted with \`\\\\frac{numerator}{denominator}\`.
           - Options: Ensure options are also formatted with LaTeX if they contain math.
         4. **Diagrams**:
            - **Trigger Condition**: Check if the question text contains keywords like "그림", "다음 그림", "아래 그림", "회로도", "결선도".
            - **Action**: IF AND ONLY IF these keywords are present OR there is a clearly visible diagram/chart/graph associated with the question:
              - Detect the bounding box coordinates of the diagram in the image.
              - Return the coordinates in 'diagramBounds' as: { x: number, y: number, width: number, height: number }
              - Coordinates should be in pixels, relative to the top-left corner of the image (0, 0).
            - If NO diagram is present or keywords are missing, set 'diagramBounds' to null.
            - Also describe the diagram briefly in Korean in the 'questionText' (e.g., "[회로도: R1=10Ω 병렬 연결...]").
         5. **Subject**: Identify the subject in Korean (e.g., '전기자기학', '회로이론', '전력공학', '전기기기', '전기설비기술기준'). ${subjectHint ? `Prefer using \"${subjectHint}\" if applicable.` : ''}
         6. **Answer**: Solve the question to find the correct answer index (0-3).
         7. **Explanation**: Provide a detailed explanation in Korean.
           - **CRITICAL**: Use proper Korean spacing (띄어쓰기). Each word must be separated by a space.
           - **Example**: "정답은 ①입니다. 이는 옴의 법칙을 적용한 것입니다." (NOT "정답은①입니다.이는옴의법칙을적용한것입니다.")
           - **Solution**: Step-by-step solution with proper spacing.
           - **Key Memorization Point (암기 포인트)**: Explicitly state the formulas, concepts, or values that must be memorized to solve this type of problem.
        8. **Hint**: Provide a short, helpful hint (e.g., "Think about Ohm's Law") in Korean with proper spacing.
        9. **Rationale**: Provide a detailed reasoning for the correct answer and why distractors are incorrect. Use proper Korean spacing.
        10. **Topic Classification**:
           - Identify the 'topicCategory' for the question.
           - Choose the most relevant topic from the following list based on the 'subject':
           ${JSON.stringify(SUBJECT_TOPICS)}
           - If the subject is not in the list or the topic is unclear, select the best fitting general topic or leave null.
           - Also extract 2-3 'topicKeywords' (e.g., "Ohm's Law", "Voltage Drop").
        11. **Output**: Return a JSON array of QuestionModel objects.
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
                    schema
                }
            }
        });

        if (error) throw error;
        const questions = data as QuestionModel[];
        const enforceNumberRule = isElectricalEngineerSubjectSet(allowedSubjects);

        // Post-processing: Enforce subject rules and STRICT diagram filtering
        return questions.map(q => {
            let processedQ = { ...q };
            let match: RegExpMatchArray | null = null;

            // 1. Enforce Subject Rules (only for 전기기사 기본 세트)
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

            processedQ.topicCategory = normalizeTopicForSubject(processedQ.subject, processedQ.topicCategory);

            // 2. STRICT Diagram Filtering
            const diagramKeywords = ["그림", "다음 그림", "아래 그림", "회로도", "결선도"];
            const hasKeyword = diagramKeywords.some(keyword => processedQ.questionText.includes(keyword));

            if (processedQ.diagramBounds && !hasKeyword) {
                console.log(`[Rule-Based] Question ${match ? match[1] : 'unknown'}: Removed false positive diagram (No keywords found).`);
                processedQ.diagramBounds = undefined;
            }

            return processedQ;
        });

    } catch (error) {
        console.error("Error analyzing images:", error);
        throw new Error(`Failed to extract questions from images: ${error instanceof Error ? error.message : String(error)}`);
    }
};

/**
 * Determines the subject based on the question number.
 */
function determineSubjectByNumber(number: number): string | null {
    if (number >= 1 && number <= 20) return '전기자기학';
    if (number >= 21 && number <= 40) return '전력공학';
    if (number >= 41 && number <= 60) return '전기기기';
    if (number >= 61 && number <= 80) return '회로이론 및 제어공학';
    if (number >= 81 && number <= 100) return '전기설비기술기준 및 판단기준';
    return null;
}

export const generateFiveVariants = async (originalQuestion: QuestionModel, examStandardsText?: string): Promise<QuestionModel[]> => {
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
                rationale: { type: "STRING" },
            },
            required: ["questionText", "options", "answerIndex", "aiExplanation"]
        }
    };

    const standardsContext = examStandardsText
        ? `\n\n**출제 기준 참조 (Exam Standards Reference):**\n${examStandardsText.substring(0, 3000)}\n\n위 출제 기준을 참고하여 해당 범위 내에서 문제를 생성하세요. 출제 기준에 명시된 핵심 개념, 공식, 기술을 활용하세요.\n`
        : '';

    const prompt = `
        You are an expert exam question generator for Korean certification exams.
        Based on the following original question, generate EXACTLY 5 unique variant questions.
        ${standardsContext}
        **Original Question:**
        Subject: ${originalQuestion.subject}
        Question: ${originalQuestion.questionText}
        Options: ${JSON.stringify(originalQuestion.options)}
        Answer: ${originalQuestion.options[originalQuestion.answerIndex]}
        
        **Requirements:**
        1. **Language**: ALL output MUST be in KOREAN (한국어).
        2. Keep the same subject and topic.
        3. ${examStandardsText ? 'Generate questions based on the exam standards provided above. Focus on concepts, formulas, and techniques mentioned in the standards.' : 'Vary the numerical values or specific scenarios while testing the same underlying principle.'}
        4. Ensure each variant has 4 options and 1 correct answer.
        5. **Math & Formulas**: ALL mathematical formulas, symbols, and variables MUST be in LaTeX format enclosed in '$'.
           - **CRITICAL JSON FORMATTING**: You are outputting JSON. Therefore, ALL backslashes in LaTeX must be **DOUBLE ESCAPED** (e.g., use \`\\\\\\\frac\` instead of \`\\\\frac\`, \`\\\\\\\times\` instead of \`\\\\times\`).
           - Example: Write \`$ \\\\\\\\frac{\\\\\\\\partial B}{\\\\\\\\partial t} $\` (in JSON string it will look like \`"$\\\\\\\\frac{\\\\\\\\partial B}{\\\\\\\\partial t}$"\`).
           - Do not use Unicode for math (e.g., do not use '×', '÷', 'Ω', 'π' directly). Use LaTeX (e.g., \`\\\\\\\\times\`, \`\\\\\\\\div\`, \`\\\\\\\\Omega\`, \`\\\\\\\\pi\`).
           - Ensure fractions are properly formatted with \`\\\\\\\\frac{numerator}{denominator}\`.
           - Options: Ensure options are also formatted with LaTeX if they contain math.
        6. **Explanation**: Provide a clear explanation for each.
           - **Structure**: Solution + Key Memorization Point (암기 포인트).
        7. **Hint**: Provide a short hint for the new variant question.
        8. **Rationale**: Provide a detailed rationale for the correct answer.
        9. Return a JSON array of 5 objects.
    `;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateVariant',
                payload: { prompt, schema }
            }
        });

        if (error) throw error;
        const variants = data;
        return variants.map((v: any) => ({
            ...v,
            id: 0, // ID will be assigned by DB
            subject: originalQuestion.subject,
            year: originalQuestion.year,
            isVariant: true,
            parentQuestionId: originalQuestion.id,
            certification: originalQuestion.certification
        }));
    } catch (error) {
        console.error("Error generating 5 variants:", error);
        throw new Error("Failed to generate variant questions.");
    }
};

export const searchYoutubeTutorial = async (keywords: string): Promise<any[]> => {
    console.log(`Searching YouTube for: ${keywords}`);
    return Promise.resolve([]);
};

export async function classifyQuestionTopic(
    question: QuestionModel
): Promise<{
    topicCategory: string;
    topicKeywords: string[];
    difficultyLevel: 'easy' | 'medium' | 'hard';
}> {
    const prompt = `
다음 전기기사 실기 시험 문제를 분석하여 주제를 분류해주세요.

과목: ${question.subject}
문제: ${question.questionText}
보기: ${question.options.join(', ')}

다음 형식의 JSON으로 응답해주세요:
{
  "topicCategory": "구체적인 주제명",
  "topicKeywords": ["핵심", "키워드", "배열"],
  "difficultyLevel": "easy | medium | hard"
}

주제 분류 가이드 (과목별):
(생략 - 이전과 동일)
난이도 기준:
- easy: 기본 공식 직접 적용, 단순 계산 (1-2단계)
- medium: 여러 단계 계산, 개념 이해 필요 (3-4단계)
- hard: 복잡한 회로 해석, 고급 개념, 응용 (5단계 이상)

주제명은 구체적이고 명확하게 작성하세요.
`;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-proxy', {
            body: {
                action: 'generateContent',
                payload: {
                    model: 'gemini-2.0-flash-exp',
                    prompt,
                    schema: {
                        type: "OBJECT",
                        properties: {
                            topicCategory: { type: "STRING" },
                            topicKeywords: { type: "ARRAY", items: { type: "STRING" } },
                            difficultyLevel: { type: "STRING" }
                        }
                    }
                }
            }
        });

        if (error) throw error;

        // Handle potential string response if schema wasn't strictly enforced by proxy logic for generic content
        // But our proxy logic for generateContent with schema handles JSON parsing if schema is present?
        // Actually my proxy code for generateContent returns response.text.
        // So I need to parse it here.

        const text = typeof data === 'string' ? data : JSON.stringify(data);
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanText);

        const normalizedTopic = normalizeTopicForSubject(question.subject, parsed.topicCategory);
        return {
            topicCategory: normalizedTopic,
            topicKeywords: Array.isArray(parsed.topicKeywords) ? parsed.topicKeywords : [],
            difficultyLevel: parsed.difficultyLevel || 'medium',
        };
    } catch (error) {
        console.error('Topic classification error:', error);
        return {
            topicCategory: normalizeTopicForSubject(question.subject, undefined),
            topicKeywords: [],
            difficultyLevel: 'medium'
        };
    }
}

export async function batchClassifyTopics(
    questions: QuestionModel[]
): Promise<QuestionModel[]> {
    const classified: QuestionModel[] = [];

    console.log(`Starting topic classification for ${questions.length} questions...`);

    for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        console.log(`Classifying question ${i + 1}/${questions.length}...`);

        try {
            const classification = await classifyQuestionTopic(question);
            classified.push({
                ...question,
                ...classification,
            });
        } catch (error) {
            console.error(`Failed to classify question ${question.id}:`, error);
            classified.push({
                ...question,
                topicCategory: '기타',
                topicKeywords: [],
                difficultyLevel: 'medium'
            });
        }
    }

    console.log(`Topic classification complete! ${classified.length} questions classified.`);
    return classified;
}

export const extractTextFromImages = async (images: string[]): Promise<string> => {
    const prompt = `
        You are an expert OCR system.
        Extract ALL text from the provided images of documents.
        Return ONLY the extracted text. Do not add any conversational filler.
        Preserve the structure and formatting as much as possible.
        If there are multiple images, separate the content of each image with "---PAGE BREAK---".
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
                action: 'generateContent',
                payload: {
                    prompt,
                    imageParts
                }
            }
        });

        if (error) throw error;

        // data should be the text response
        return typeof data === 'string' ? data : JSON.stringify(data);

    } catch (error) {
        console.error("Error extracting text from images:", error);
        throw new Error("Failed to extract text from images.");
    }
};
