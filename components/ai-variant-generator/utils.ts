
import { ExtractedImage, PdfQuestionAnchor, PdfQuestionAnchor as PdfAnchor, PdfPageText } from '../../utils/pdfUtils';
import { QuestionModel } from '../../types';

export interface SubjectProcessingPackage {
    subjectName: string;
    questions: QuestionModel[];
    questionPageMap: [number, number][];
    questionDiagramMap: [number, { pageIndex: number, bounds: { x: number, y: number, width: number, height: number } }][];
    previewImages: Array<{
        pageIndex: number;
        imageUrl: string | null;
        dataUrl: string | null;
    }>;
}

export type PagePreview = SubjectProcessingPackage['previewImages'][number];

export const slugifyForStorage = (value: string): string => {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'general';
};

export const buildStandardStoragePath = (certification: string, subject: string, filename: string): string => {
    const certSlug = slugifyForStorage(certification || 'cert');
    const subjectSlug = slugifyForStorage(subject || 'subject');
    return `standards/${certSlug}/${subjectSlug}/${filename}`;
};

export interface StandardPageEntry {
    pageNumber: number;
    text: string;
}

export const MAX_STANDARD_SECTION_CHARS = 2500;
export const CURRENT_YEAR = new Date().getFullYear();
export const MIN_EXAM_YEAR = 2000;
export const MAX_EXAM_YEAR = CURRENT_YEAR + 5;

export const validateExamYearValue = (value: number | ''): string | null => {
    if (value === '') {
        return '시험 연도를 입력해 주세요.';
    }
    if (Number.isNaN(value)) {
        return '유효한 숫자를 입력해 주세요.';
    }
    if (!Number.isInteger(value)) {
        return '시험 연도는 정수로 입력해 주세요.';
    }
    if (value < MIN_EXAM_YEAR || value > MAX_EXAM_YEAR) {
        return `${MIN_EXAM_YEAR}~${MAX_EXAM_YEAR}년 사이의 값을 입력해 주세요.`;
    }
    return null;
};

export const estimateTokenCount = (content: string): number => Math.max(1, Math.round(content.length / 4));

export const chunkStandardPages = (pages: StandardPageEntry[]): Array<{
    sectionIndex: number;
    startPage: number | null;
    endPage: number | null;
    content: string;
    charCount: number;
    tokenEstimate: number;
}> => {
    const sections: Array<{
        startPage: number | null;
        endPage: number | null;
        content: string;
        charCount: number;
        tokenEstimate: number;
    }> = [];

    if (pages.length === 0) {
        return [];
    }

    let buffer = '';
    let startPage: number | null = null;
    let endPage: number | null = null;

    const flushSection = () => {
        if (!buffer.trim()) {
            buffer = '';
            startPage = null;
            endPage = null;
            return;
        }
        const content = buffer.trim();
        sections.push({
            startPage,
            endPage,
            content,
            charCount: content.length,
            tokenEstimate: estimateTokenCount(content)
        });
        buffer = '';
        startPage = null;
        endPage = null;
    };

    pages.forEach((page) => {
        const text = page.text.trim();
        if (!text) {
            return;
        }

        if (startPage === null) {
            startPage = page.pageNumber;
        }
        endPage = page.pageNumber;

        const tentativeLength = buffer.length === 0
            ? text.length
            : buffer.length + 2 + text.length; // account for "\n\n"

        if (buffer && tentativeLength > MAX_STANDARD_SECTION_CHARS) {
            flushSection();
            startPage = page.pageNumber;
            endPage = page.pageNumber;
            buffer = text;
        } else {
            buffer = buffer ? `${buffer}\n\n${text}` : text;
        }
    });

    flushSection();

    return sections.map((section, index) => ({
        ...section,
        sectionIndex: index
    }));
};

export const QUESTIONS_PER_SUBJECT = 40;

export const enforceSubjectQuestionQuota = (
    primary: QuestionModel[],
    fallbackPool: QuestionModel[],
    limit: number = QUESTIONS_PER_SUBJECT,
    isAllowed?: (question: QuestionModel) => boolean
): QuestionModel[] => {
    if (primary.length >= limit) {
        return primary.slice(0, limit);
    }

    const result: QuestionModel[] = [];
    const seen = new Set<QuestionModel>();

    const tryAdd = (question: QuestionModel) => {
        if (isAllowed && !isAllowed(question)) {
            return false;
        }
        if (seen.has(question)) {
            return false;
        }
        seen.add(question);
        result.push(question);
        return result.length >= limit;
    };

    for (const question of primary) {
        if (tryAdd(question)) {
            return result;
        }
    }

    for (const question of fallbackPool) {
        if (tryAdd(question)) {
            break;
        }
    }

    return result;
};

export type ProblemType = 'diagram' | 'table_graph' | 'calculation' | 'concept' | 'definition' | 'unknown';
export type SolveRoute = 'diagram-llm' | 'text-llm' | 'code-verify';

export interface ProblemClassification {
    problemType: ProblemType;
    solveRoute: SolveRoute;
    requiredSignals: string[];
}

const DIAGRAM_KEYWORDS = [
    '그림',
    '회로',
    '회로도',
    '결선',
    '배선',
    '도면',
    '도식'
];

const GRAPH_TABLE_KEYWORDS = [
    '그래프',
    '곡선',
    '도표',
    '표',
    '좌표',
    '축',
    '눈금',
    '스케일'
];

const DEFINITION_HINTS = [
    '옳은 것은',
    '옳지 않은 것은',
    '틀린 것은',
    '맞는 것은',
    '가장 적절',
    '정의',
    '설명',
    '의미'
];

const NUMERIC_UNIT_REGEX = /[0-9][0-9.,]*\s?(V|A|W|kW|kV|mA|mV|Ω|ohm|Hz|N|Pa|kPa|MPa|mm|cm|m|kg|g|s|ms|%|볼트|암페어|와트|옴|헤르츠)/i;

const containsAny = (text: string, keywords: string[]) => {
    return keywords.some(keyword => text.includes(keyword));
};

export const classifyProblem = (question: QuestionModel): ProblemClassification => {
    const text = `${question.questionText || ''} ${Array.isArray(question.options) ? question.options.join(' ') : ''}`;
    const requiredSignals: string[] = [];

    const hasDiagramInfo = Boolean(question.diagram_info);
    const hasAxesOrTable = Boolean(question.diagram_info?.axes || question.diagram_info?.table_entries?.length);
    const hasDiagramKeyword = containsAny(text, DIAGRAM_KEYWORDS);
    const hasGraphKeyword = containsAny(text, GRAPH_TABLE_KEYWORDS);

    if (question.diagramBounds || hasDiagramInfo || hasDiagramKeyword) {
        requiredSignals.push('diagram');
    }

    const hasNumeric = NUMERIC_UNIT_REGEX.test(text);
    if (hasNumeric) {
        requiredSignals.push('numeric');
    }

    if (hasAxesOrTable || hasGraphKeyword) {
        return {
            problemType: 'table_graph',
            solveRoute: 'diagram-llm',
            requiredSignals
        };
    }

    if (question.diagramBounds || hasDiagramInfo || hasDiagramKeyword) {
        return {
            problemType: 'diagram',
            solveRoute: 'diagram-llm',
            requiredSignals
        };
    }

    if (hasNumeric) {
        return {
            problemType: 'calculation',
            solveRoute: 'code-verify',
            requiredSignals
        };
    }

    if (containsAny(text, DEFINITION_HINTS)) {
        return {
            problemType: 'definition',
            solveRoute: 'text-llm',
            requiredSignals
        };
    }

    return {
        problemType: 'concept',
        solveRoute: 'text-llm',
        requiredSignals
    };
};

export const applyProblemClassification = (questions: QuestionModel[]): QuestionModel[] => {
    return questions.map(question => {
        const classification = classifyProblem(question);
        const requiresDiagram = classification.problemType === 'diagram' || classification.problemType === 'table_graph';
        const needsManualDiagram = Boolean(
            question.needsManualDiagram ||
            (requiresDiagram && !question.diagramBounds && !question.diagramUrl)
        );
        return {
            ...question,
            ...classification,
            needsManualDiagram
        };
    });
};


export const extractLeadingQuestionNumber = (text: string): number | null => {
    const normalized = text.trim();
    const directMatch = normalized.match(/^(\d{1,3})\s*(?:[).:-]|번)/);
    if (directMatch) {
        return parseInt(directMatch[1], 10);
    }

    const altMatch = normalized.match(/^제?\s*(\d{1,3})\s*문/);
    if (altMatch) {
        return parseInt(altMatch[1], 10);
    }

    const labelMatch = normalized.match(/^(문항|문제)\s*(\d{1,3})/);
    if (labelMatch) {
        return parseInt(labelMatch[2], 10);
    }

    return null;
};

export const assignDiagramsToQuestions = (
    anchorsByPage: Map<number, PdfQuestionAnchor[]>,
    images: ExtractedImage[]
): Map<number, ExtractedImage[]> => {
    const assignments = new Map<number, ExtractedImage[]>();

    anchorsByPage.forEach((anchors, pageIndex) => {
        if (!anchors || anchors.length === 0) {
            return;
        }
        const sortedAnchors = [...anchors].sort((a, b) => a.y - b.y);
        const pageImages = images.filter(img => img.pageIndex === pageIndex);

        pageImages.forEach(img => {
            const centerY = img.y + img.height / 2;
            let targetAnchor = sortedAnchors[sortedAnchors.length - 1];

            for (let i = 0; i < sortedAnchors.length; i++) {
                const current = sortedAnchors[i];
                const next = sortedAnchors[i + 1];
                const nextY = next ? next.y : Infinity;

                if (centerY >= current.y && centerY < nextY) {
                    targetAnchor = current;
                    break;
                }
            }

            if (!assignments.has(targetAnchor.questionNumber)) {
                assignments.set(targetAnchor.questionNumber, []);
            }
            assignments.get(targetAnchor.questionNumber)!.push(img);
        });
    });

    return assignments;
};

export const createXObjectMetadata = (
    objects: ExtractedImage[],
    urlMap: Map<string, string>
) => {
    return objects.map(obj => {
        const imageUrl = urlMap.get(obj.id) || null;
        const metadata: any = {
            id: obj.id,
            pageIndex: obj.pageIndex,
            x: obj.x,
            y: obj.y,
            width: obj.width,
            height: obj.height,
            imageUrl
        };
        if (!imageUrl) {
            metadata.dataUrl = obj.dataUrl;
        }
        return metadata;
    });
};

export const extractYearFromFilename = (filename: string): number | null => {
    // Try to match 4-digit year first (2000-2099)
    const fourDigitMatch = filename.match(/20\d{2}/);
    if (fourDigitMatch) {
        const year = parseInt(fourDigitMatch[0]);
        if (year >= 2000 && year <= 2030) {
            return year;
        }
    }

    // Try to match 2-digit year (00-30 for 2000-2030)
    // Look for patterns like "24년", "24_", "_24.", "24회" etc.
    const twoDigitMatch = filename.match(/[_\s\-년](\d{2})[\s_\-년회차.]/);
    if (twoDigitMatch) {
        const twoDigitYear = parseInt(twoDigitMatch[1]);
        // Convert 00-30 to 2000-2030
        if (twoDigitYear >= 0 && twoDigitYear <= 30) {
            return 2000 + twoDigitYear;
        }
    }

    // Also try matching 2-digit year at the start or end
    const startEndMatch = filename.match(/^(\d{2})[_\s\-년]|[_\s\-년](\d{2})$/);
    if (startEndMatch) {
        const twoDigitYear = parseInt(startEndMatch[1] || startEndMatch[2]);
        if (twoDigitYear >= 0 && twoDigitYear <= 30) {
            return 2000 + twoDigitYear;
        }
    }

    return null;
};

export const cropDiagram = (base64Image: string, bounds: { x: number, y: number, width: number, height: number }): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            canvas.width = bounds.width;
            canvas.height = bounds.height;

            // Draw the cropped portion
            ctx.drawImage(
                img,
                bounds.x, bounds.y, bounds.width, bounds.height,  // Source rectangle
                0, 0, bounds.width, bounds.height                  // Destination rectangle
            );

            // Convert to base64 JPEG
            const croppedBase64 = canvas.toDataURL('image/jpeg', 0.8);
            resolve(croppedBase64);
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = base64Image;
    });
};

export const fetchImageAsBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};
