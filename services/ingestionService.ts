import { supabase } from './supabaseClient';
import { QuestionModel } from '../types';

export interface IngestionJobPayload {
    certification?: string;
    subject?: string;
    year?: number | null;
    exam_session?: number | null;
    source?: string;
    request_payload?: Record<string, unknown>;
    structure_analysis?: Record<string, unknown>;
    problem_class?: string;
    solve_input?: Record<string, unknown>;
    solver_output?: Record<string, unknown>;
    verification_result?: Record<string, unknown>;
    verification_summary?: Record<string, unknown>;
    failure_reason?: string | null;
    status?: string;
}

export const createIngestionJob = async (payload: IngestionJobPayload) => {
    const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: {
            action: 'ingestionStart',
            payload
        }
    });

    if (error) {
        throw error;
    }

    if (data && typeof data === 'object' && 'ok' in data) {
        if (!data.ok) {
            throw new Error(data.error || 'Failed to create ingestion job');
        }
        return data.data as { id: number; status: string };
    }

    return data as { id: number; status: string };
};

export const fetchIngestionJobById = async (jobId: number) => {
    const { data, error } = await supabase
        .from('ingestion_jobs')
        .select('id, structure_analysis')
        .eq('id', jobId)
        .single();

    if (error) {
        throw error;
    }

    return data as {
        id: number;
        structure_analysis: Array<{
            questionIndex: number;
            questionNumber: number | null;
            problemClass: string | null;
            diagramType: string | null;
            givenValues: string[] | null;
            unknowns: string[] | null;
        }> | null;
    };
};

export const buildSubjectIngestionPayload = (args: {
    certification?: string;
    subject: string;
    year?: number | null;
    examSession?: number | null;
    mode: 'txt' | 'pdf-text' | 'image';
    questionCount: number;
    questions: QuestionModel[];
    verificationSummary?: {
        verifiedCount: number;
        needsReviewCount: number;
        reasons: Record<string, number>;
    };
}) => {
    const { certification, subject, year, examSession, mode, questionCount, questions, verificationSummary } = args;
    const diagramCount = questions.filter(q => q.problemType === 'diagram' || q.problemType === 'table_graph').length;
    const unknownCount = questions.filter(q => q.problemType === 'unknown').length;
    const needsReviewByVerification = (verificationSummary?.needsReviewCount ?? 0) > 0;
    const status = unknownCount > 0 || needsReviewByVerification ? 'NEEDS_REVIEW' : 'CLASSIFIED';
    const failure_reason = unknownCount > 0
        ? 'UNKNOWN_PROBLEM_CLASS'
        : needsReviewByVerification ? 'SOLVE_INPUT_INCOMPLETE' : null;
    const structure_analysis = questions.map((question, index) => ({
        questionIndex: index,
        questionNumber: question.questionNumber ?? null,
        problemClass: question.problemClass ?? null,
        diagramType: question.structureAnalysis?.diagram_type ?? null,
        givenValues: question.structureAnalysis?.given_values ?? null,
        unknowns: question.structureAnalysis?.unknowns ?? null
    }));

    return {
        certification,
        subject,
        year,
        exam_session: examSession ?? null,
        source: mode,
        request_payload: {
            questionCount,
            diagramCount,
            unknownCount
        },
        structure_analysis,
        verification_summary: verificationSummary,
        failure_reason,
        status
    } satisfies IngestionJobPayload;
};
