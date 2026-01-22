import { DiagramType, ProblemClass, QuestionModel, QuestionStructureAnalysis, StructuredSolveInput } from '../types';

const toLower = (value: string) => value.toLowerCase();

const parseNumberWithUnit = (tokens: string[], unitMatchers: RegExp[]) => {
    for (const token of tokens) {
        for (const matcher of unitMatchers) {
            const match = matcher.exec(token);
            if (match) {
                const value = Number(match[1].replace(/,/g, ''));
                if (Number.isFinite(value)) {
                    return value;
                }
            }
        }
    }
    return undefined;
};

export type VerificationStatus = 'VERIFIED' | 'NEEDS_REVIEW';

export interface VerificationResult {
    status: VerificationStatus;
    reason?: string;
}

const getSeriesParallelCounts = (text: string) => {
    const normalized = text.replace(/\s+/g, ' ');
    const seriesMatch = normalized.match(/(?:직렬|series)\s*([0-9]{1,2})/i);
    const parallelMatch = normalized.match(/(?:병렬|parallel)\s*([0-9]{1,2})/i);
    return {
        series: seriesMatch ? Number(seriesMatch[1]) : undefined,
        parallel: parallelMatch ? Number(parallelMatch[1]) : undefined
    };
};

const applyDiagramTypeOverride = (structure: QuestionStructureAnalysis): DiagramType => {
    const text = `${structure.question_text_raw || ''} ${(structure.diagram_elements || []).join(' ')}`.toLowerCase();
    const hasFluxHints = ['자속', '자극', '유기', '기전력', '입체각', 'θ', 'theta'].some(token => text.includes(token));
    const hasCircuitHints = ['회로', '직렬', '병렬', '저항', '전압', '전류'].some(token => text.includes(token));
    const hasGeometryHints = ['투영', '면적', '도형', '기하', '평면'].some(token => text.includes(token));

    if (hasFluxHints) return 'FLUX';
    if (hasCircuitHints) return 'CIRCUIT';
    if (hasGeometryHints) return 'GEOMETRY';
    return structure.diagram_type || 'UNKNOWN';
};

export const classifyProblemClass = (structure: QuestionStructureAnalysis): ProblemClass => {
    const diagramType = applyDiagramTypeOverride(structure);
    switch (diagramType) {
        case 'CIRCUIT':
            return 'CIRCUIT_SERIES_PARALLEL';
        case 'FLUX':
            return 'FLUX_SOLID_ANGLE';
        case 'GEOMETRY':
            return 'GEOMETRY_PROJECTION';
        default:
            return 'UNKNOWN';
    }
};

export const buildSolveInput = (
    structure: QuestionStructureAnalysis,
    problemClass: ProblemClass,
    questionText: string
): StructuredSolveInput => {
    const tokens = structure.given_values || [];

    if (problemClass === 'CIRCUIT_SERIES_PARALLEL') {
        const voltage = parseNumberWithUnit(tokens, [
            /([0-9]+(?:\.[0-9]+)?)\s*(k?V|볼트)/i
        ]);
        const capacity = parseNumberWithUnit(tokens, [
            /([0-9]+(?:\.[0-9]+)?)\s*(m?Ah|Ah)/i
        ]);
        const counts = getSeriesParallelCounts(questionText);
        return {
            type: 'CIRCUIT_SERIES_PARALLEL',
            battery: {
                voltage,
                capacity
            },
            series_per_string: counts.series,
            parallel_strings: counts.parallel,
            raw_tokens: tokens
        };
    }

    if (problemClass === 'FLUX_SOLID_ANGLE') {
        const normalizedTokens = tokens.map(toLower);
        const findToken = (needle: string) => tokens.find(token => toLower(token).includes(needle));
        return {
            type: 'FLUX_SOLID_ANGLE',
            monopole_strength: findToken('m') || findToken('자극') || undefined,
            loop_radius: findToken('a') || findToken('반지름') || undefined,
            positions: normalizedTokens.filter(token => token.includes('d')).map((_, idx) => tokens[idx]),
            angles: {
                theta1: findToken('θ1') || findToken('theta1') || findToken('각1'),
                theta2: findToken('θ2') || findToken('theta2') || findToken('각2')
            },
            time: findToken('t') || findToken('시간'),
            raw_tokens: tokens
        };
    }

    if (problemClass === 'GEOMETRY_PROJECTION') {
        return {
            type: 'GEOMETRY_PROJECTION',
            raw_tokens: tokens
        };
    }

    return {
        type: 'UNKNOWN',
        raw_tokens: tokens
    };
};

export const runStructureClassification = (
    question: QuestionModel,
    structure: QuestionStructureAnalysis
) => {
    const normalizedStructure: QuestionStructureAnalysis = {
        ...structure,
        diagram_type: applyDiagramTypeOverride(structure)
    };
    const problemClass = classifyProblemClass(normalizedStructure);
    const solveInput = buildSolveInput(normalizedStructure, problemClass, question.questionText);
    return { normalizedStructure, problemClass, solveInput };
};

export const verifySolveInput = (question: QuestionModel): VerificationResult => {
    if (!question.problemClass) {
        if (question.problemType === 'diagram' || question.problemType === 'table_graph') {
            return { status: 'NEEDS_REVIEW', reason: 'STRUCTURE_MISSING' };
        }
        return { status: 'VERIFIED' };
    }

    if (!question.solveInput) {
        return { status: 'NEEDS_REVIEW', reason: 'SOLVE_INPUT_MISSING' };
    }

    if (question.problemClass === 'CIRCUIT_SERIES_PARALLEL') {
        const input = question.solveInput as StructuredSolveInput;
        if (input.type !== 'CIRCUIT_SERIES_PARALLEL') {
            return { status: 'NEEDS_REVIEW', reason: 'CIRCUIT_INPUT_INCOMPLETE' };
        }
        const battery = (input as any).battery || {};
        if (!battery.voltage || !battery.capacity || !(input as any).series_per_string || !(input as any).parallel_strings) {
            return { status: 'NEEDS_REVIEW', reason: 'CIRCUIT_INPUT_INCOMPLETE' };
        }
        return { status: 'VERIFIED' };
    }

    if (question.problemClass === 'FLUX_SOLID_ANGLE') {
        const input = question.solveInput as StructuredSolveInput;
        if (input.type !== 'FLUX_SOLID_ANGLE') {
            return { status: 'NEEDS_REVIEW', reason: 'FLUX_INPUT_INCOMPLETE' };
        }
        const angles = (input as any).angles || {};
        if (!angles.theta1 || !angles.theta2 || !(input as any).time) {
            return { status: 'NEEDS_REVIEW', reason: 'FLUX_INPUT_INCOMPLETE' };
        }
        return { status: 'VERIFIED' };
    }

    if (question.problemClass === 'GEOMETRY_PROJECTION') {
        const input = question.solveInput as StructuredSolveInput;
        if (input.type !== 'GEOMETRY_PROJECTION') {
            return { status: 'NEEDS_REVIEW', reason: 'GEOMETRY_INPUT_INCOMPLETE' };
        }
        if (!(input as any).raw_tokens || (input as any).raw_tokens.length === 0) {
            return { status: 'NEEDS_REVIEW', reason: 'GEOMETRY_INPUT_INCOMPLETE' };
        }
        return { status: 'VERIFIED' };
    }

    return { status: 'NEEDS_REVIEW', reason: 'UNKNOWN_PROBLEM_CLASS' };
};
