import React, { useState, useEffect, useRef } from 'react';

import { Screen, QuestionModel, AuthSession } from '../types';

import { analyzeQuestionsFromText, generateFiveVariants, analyzeQuestionsFromImages, extractTextFromImages } from '../services/geminiService';

import { quizApi } from '../services/quizApi';

import FormattedText from './FormattedText';

import { isAdmin } from '../services/authService';

import { uploadBase64Image, uploadTextFile, uploadDiagramImage, uploadXObjectImage, generateUniqueFilename, uploadToStorage } from '../services/storageService';

import * as pdfjsLib from 'pdfjs-dist';

import { extractImagesFromPdf, ExtractedImage, extractStructuredTextFromPdf, PdfPageText, PdfQuestionAnchor } from '../utils/pdfUtils';
import { Certification, CERTIFICATION_SUBJECTS } from '../constants';

import { supabase } from '../services/supabaseClient';

// @ts-ignore

import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';



// Configure worker

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;



const slugifyForStorage = (value: string): string => {

    return value

        .normalize('NFKD')

        .replace(/[\u0300-\u036f]/g, '')

        .replace(/[^\w]+/g, '-')

        .replace(/-+/g, '-')

        .replace(/^-|-$/g, '')

        .toLowerCase() || 'general';

};



const buildStandardStoragePath = (certification: string, subject: string, filename: string): string => {

    const certSlug = slugifyForStorage(certification || 'cert');

    const subjectSlug = slugifyForStorage(subject || 'subject');

    return `standards/${certSlug}/${subjectSlug}/${filename}`;

};



interface StandardPageEntry {

    pageNumber: number;

    text: string;

}



const MAX_STANDARD_SECTION_CHARS = 2500;



const estimateTokenCount = (content: string): number => Math.max(1, Math.round(content.length / 4));



const chunkStandardPages = (pages: StandardPageEntry[]): Array<{

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



interface SubjectRangeConfig {

    id: string;

    name: string;

    startPage: number;

    endPage: number;

    questionStart: number;

    questionEnd: number;

}



const CERTIFICATION_RANGE_TEMPLATES: Record<Certification, Array<Omit<SubjectRangeConfig, 'id'>>> = {
    '전기기사': [
        { name: '전기자기학', startPage: 1, endPage: 2, questionStart: 1, questionEnd: 20 },
        { name: '전력공학', startPage: 2, endPage: 3, questionStart: 21, questionEnd: 40 },
        { name: '전기기기', startPage: 3, endPage: 4, questionStart: 41, questionEnd: 60 },
        { name: '회로이론 및 제어공학', startPage: 4, endPage: 5, questionStart: 61, questionEnd: 80 },
        { name: '전기설비기술기준 및 판단기준', startPage: 5, endPage: 6, questionStart: 81, questionEnd: 100 }
    ],
    '신재생에너지발전설비기사(태양광)': [
        { name: '태양광발전 기획', startPage: 1, endPage: 2, questionStart: 1, questionEnd: 20 },
        { name: '태양광발전 설계', startPage: 2, endPage: 3, questionStart: 21, questionEnd: 40 },
        { name: '태양광발전 시공', startPage: 3, endPage: 4, questionStart: 41, questionEnd: 60 },
        { name: '태양광발전 운영', startPage: 4, endPage: 5, questionStart: 61, questionEnd: 80 }
    ],
    '소방설비산업기사(전기)': [
        { name: '소방원론', startPage: 1, endPage: 2, questionStart: 1, questionEnd: 20 },
        { name: '소방전기 일반', startPage: 2, endPage: 3, questionStart: 21, questionEnd: 40 },
        { name: '소방관계법규', startPage: 3, endPage: 4, questionStart: 41, questionEnd: 60 },
        { name: '소방전기시설의 구조 및 원리', startPage: 4, endPage: 5, questionStart: 61, questionEnd: 80 }
    ]
};

const createSubjectRange = (overrides: Partial<Omit<SubjectRangeConfig, 'id'>> = {}): SubjectRangeConfig => ({
    id: `subject-${Math.random().toString(36).slice(2, 11)}`,
    name: '',
    startPage: 1,
    endPage: 1,

    questionStart: 1,

    questionEnd: 1,

    ...overrides,

});



const buildFallbackRanges = (certification: Certification): Array<Omit<SubjectRangeConfig, 'id'>> => {
    const subjects = CERTIFICATION_SUBJECTS[certification] || [];
    const defaultBlock = subjects.length > 0 ? Math.floor(100 / subjects.length) : 20;

    return subjects.map((subject, index) => {
        const start = index * defaultBlock + 1;
        const end = (index + 1) * defaultBlock;
        return {
            name: subject,
            startPage: start,
            endPage: end,
            questionStart: start,
            questionEnd: end
        };
    });
};

const createDefaultSubjectRanges = (certification: Certification): SubjectRangeConfig[] => {
    const templates = CERTIFICATION_RANGE_TEMPLATES[certification] || buildFallbackRanges(certification);
    return templates.map((template) => createSubjectRange(template));
};


const extractLeadingQuestionNumber = (text: string): number | null => {
    const normalized = text.trim();
    const directMatch = normalized.match(/^(\d{1,3})\s*(?:[).:-]|번)/);
    if (directMatch) {
        return parseInt(directMatch[1], 10);
    }



    const altMatch = normalized.match(/^제?\s*(\d{1,3})\s*문/);

    if (altMatch) {

        return parseInt(altMatch[1], 10);

    }



    return null;
};

const assignDiagramsToQuestions = (
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

const createXObjectMetadata = (
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

interface PdfSourceMeta {
    file: File;
    data: Uint8Array;
    pageCount: number;
    baseIndex: number;
}

interface SubjectProcessingPackage {
    subjectName: string;
    questions: QuestionModel[];
    questionPageMap: Array<[number, number]>;
    questionDiagramMap: Array<[number, { pageIndex: number; bounds: { x: number; y: number; width: number; height: number } }]>;
    previewImages: ReturnType<typeof createPreviewImageMetadata>;
}


interface AiVariantGeneratorScreenProps {

    navigate: (screen: Screen) => void;

    session: AuthSession;

    certification: Certification;

    onQuestionsUpdated?: () => void;

}



const AiVariantGeneratorScreen: React.FC<AiVariantGeneratorScreenProps> = ({ navigate, session, certification, onQuestionsUpdated }) => {

    // File upload state

    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

    const [isDragging, setIsDragging] = useState(false);



    // Processing state

    const [isProcessing, setIsProcessing] = useState(false);

    const [isSaveCompleted, setIsSaveCompleted] = useState(false);

    const [statusMessage, setStatusMessage] = useState('');

    const [extractedQuestions, setExtractedQuestions] = useState<QuestionModel[]>([]);

    const [generatedVariants, setGeneratedVariants] = useState<QuestionModel[]>([]);

    const [error, setError] = useState<string | null>(null);

    const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

    const [previewImages, setPreviewImages] = useState<string[]>([]);



    // Store mapping of question index to its source page index

    const [questionPageMap, setQuestionPageMap] = useState<Map<number, number>>(new Map());

    // Store diagram bounds for each question

    const [questionDiagramMap, setQuestionDiagramMap] = useState<Map<number, { pageIndex: number, bounds: { x: number, y: number, width: number, height: number } }>>(new Map());

    const [xObjects, setXObjects] = useState<ExtractedImage[]>([]);

    const [generateVariants, setGenerateVariants] = useState(false);
    const xObjectUrlCacheRef = useRef<Map<string, string>>(new Map());



    // Subject-based processing state

    const [currentSubject, setCurrentSubject] = useState<string | null>(null);

    const [completedSubjects, setCompletedSubjects] = useState<string[]>([]);

    const [isPaused, setIsPaused] = useState(false);

    const [pendingSubjects, setPendingSubjects] = useState<string[]>([]);
    const [batchConfirmationSubject, setBatchConfirmationSubject] = useState<string | null>(null);
    const [isBatchConfirmed, setIsBatchConfirmed] = useState(false);
    const isPausedRef = useRef(isPaused);

    const cancelProcessingRef = useRef(false);
    const pageImageUrlCacheRef = useRef<Map<number, string>>(new Map());
    const pageImageDataRef = useRef<Map<number, string>>(new Map());



    // Page range state

    const [subjectRanges, setSubjectRanges] = useState<SubjectRangeConfig[]>(() => createDefaultSubjectRanges(certification));
    const [processFirstSubjectOnly, setProcessFirstSubjectOnly] = useState(false);
    const [pendingSubjectPackage, setPendingSubjectPackage] = useState<SubjectProcessingPackage | null>(null);
    const [isSavingSubject, setIsSavingSubject] = useState(false);


    // Standard upload state

    const [standardFiles, setStandardFiles] = useState<File[]>([]);

    const [isUploadingStandard, setIsUploadingStandard] = useState(false);



    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    useEffect(() => {
        setSubjectRanges(createDefaultSubjectRanges(certification));
    }, [certification]);


    const handleStandardFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {

        if (!event.target.files) {

            return;

        }



        const incomingFiles = Array.from(event.target.files) as File[];

        const validFiles = incomingFiles.filter(

            (file) => file.type === 'application/pdf' || file.type.startsWith('image/')

        );



        if (validFiles.length !== incomingFiles.length) {

            alert('PDF 또는 이미지 파일만 업로드할 수 있습니다.');

        }



        if (validFiles.length > 0) {

            setStandardFiles((prev) => [...prev, ...validFiles]);

        }



        event.target.value = '';

    };



    const removeStandardFile = (index: number) => {

        setStandardFiles(prev => prev.filter((_, i) => i !== index));

    };



    const handleUploadStandard = async () => {

        if (standardFiles.length === 0 || !selectedSubject) {

            alert('출제 기준 파일과 과목을 선택해주세요.');

            return;

        }



        setIsUploadingStandard(true);

        try {

            const pages: StandardPageEntry[] = [];

            const filesMeta: {

                url: string;

                originalFilename: string;

                fileType: string;

                fileSize: number;

                pageCount: number | null;

            }[] = [];

            let nextPageNumber = 1;



            for (const file of standardFiles) {

                const extension = file.name.split('.').pop()?.toLowerCase()

                    || (file.type === 'application/pdf' ? 'pdf' : 'bin');

                const storageFilename = generateUniqueFilename(extension);

                const storagePath = buildStandardStoragePath(certification, selectedSubject, storageFilename);

                const fileUrl = await uploadToStorage(file, storagePath);



                if (file.type === 'application/pdf') {

                    const arrayBuffer = await file.arrayBuffer();

                    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;



                    for (let i = 1; i <= pdf.numPages; i++) {

                        const page = await pdf.getPage(i);

                        const textContent = await page.getTextContent();

                        let pageText = textContent.items.map((item: any) => item.str).join(' ').trim();



                        if (pageText) {

                            pages.push({

                                pageNumber: nextPageNumber,

                                text: pageText

                            });

                        }

                        nextPageNumber++;

                    }



                    filesMeta.push({

                        url: fileUrl,

                        originalFilename: file.name,

                        fileType: file.type,

                        fileSize: file.size,

                        pageCount: pdf.numPages

                    });

                } else if (file.type.startsWith('image/')) {

                    const base64 = await new Promise<string>((resolve, reject) => {

                        const reader = new FileReader();

                        reader.onload = () => resolve(reader.result as string);

                        reader.onerror = reject;

                        reader.readAsDataURL(file);

                    });



                    const ocrText = await extractTextFromImages([base64]);

                    const segments = ocrText

                        .split(/---PAGE BREAK---/i)

                        .map(segment => segment.trim())

                        .filter(segment => segment.length > 0);

                    const effectiveSegments = segments.length > 0

                        ? segments

                        : (ocrText.trim() ? [ocrText.trim()] : []);



                    effectiveSegments.forEach(segment => {

                        pages.push({

                            pageNumber: nextPageNumber,

                            text: segment

                        });

                        nextPageNumber++;

                    });



                    if (effectiveSegments.length === 0) {

                        nextPageNumber++;

                    }



                    filesMeta.push({

                        url: fileUrl,

                        originalFilename: file.name,

                        fileType: file.type,

                        fileSize: file.size,

                        pageCount: effectiveSegments.length || 1

                    });

                }

            }



            const sortedPages = pages.sort((a, b) => a.pageNumber - b.pageNumber);

            const fullText = sortedPages

                .map(page => `# Page ${page.pageNumber}\n${page.text}`)

                .join('\n\n');



            const sections = chunkStandardPages(sortedPages).map(section => ({

                sectionIndex: section.sectionIndex,

                startPage: section.startPage,

                endPage: section.endPage,

                content: section.content,

                charCount: section.charCount,

                tokenEstimate: section.tokenEstimate

            }));



            await quizApi.saveCertificationStandard({

                certification,

                subject: selectedSubject,

                pdfUrl: filesMeta[0]?.url || '',

                extractedText: fullText,

                files: filesMeta,

                sections

            });



            alert('출제 기준이 성공적으로 저장되었습니다.');

            setStandardFiles([]);

        } catch (error) {

            console.error('Error saving standard:', error);

            const message = error instanceof Error ? error.message : '알 수 없는 오류입니다.';

            alert(`출제 기준 저장 중 오류가 발생했습니다.\n${message}`);

        } finally {

            setIsUploadingStandard(false);

        }

    };



    // File limits

    const MAX_FILES = 10;

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB



    // Helper function to extract year from filename

    const extractYearFromFilename = (filename: string): number | null => {

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







    // Validate file type and size

    const validateFile = (file: File): string | null => {

        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

        if (!validTypes.includes(file.type)) {

            return `${file.name}: 지원하지 않는 파일 형식입니다. (JPG, PNG, WebP, PDF만 가능)`;

        }

        if (file.size > MAX_FILE_SIZE) {

            return `${file.name}: 파일 크기가 너무 큽니다. (최대 10MB)`;

        }

        return null;

    };



    // Handle file selection from input

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {

        const files = Array.from(event.target.files || []) as File[];

        handleFilesAdded(files);

        // Reset input to allow selecting same files again

        event.target.value = '';

    };



    // Handle files added (from input or drag-and-drop)

    const handleFilesAdded = (files: File[]) => {

        const errors: string[] = [];

        const validFiles: File[] = [];



        // Check total file count

        if (selectedFiles.length + files.length > MAX_FILES) {

            setError(`최대 ${MAX_FILES}개의 파일만 선택할 수 있습니다.`);

            return;

        }



        // Validate each file

        files.forEach(file => {

            const error = validateFile(file);

            if (error) {

                errors.push(error);

            } else {

                validFiles.push(file);

            }

        });



        if (errors.length > 0) {

            setError(errors.join('\n'));

        } else {

            setError(null);

        }



        if (validFiles.length > 0) {

            setSelectedFiles(prev => [...prev, ...validFiles]);

        }

    };



    // Remove a specific file

    const handleRemoveFile = (index: number) => {

        setSelectedFiles(prev => prev.filter((_, i) => i !== index));

    };



    // Clear all files

    const handleClearAll = () => {

        setSelectedFiles([]);

        setError(null);

    };



    // Drag and drop handlers

    const handleDragEnter = (e: React.DragEvent) => {

        e.preventDefault();

        e.stopPropagation();

        setIsDragging(true);

    };



    const handleDragLeave = (e: React.DragEvent) => {

        e.preventDefault();

        e.stopPropagation();

        setIsDragging(false);

    };



    const handleDragOver = (e: React.DragEvent) => {

        e.preventDefault();

        e.stopPropagation();

    };



    const handleDrop = (e: React.DragEvent) => {

        e.preventDefault();

        e.stopPropagation();

        setIsDragging(false);



        const files = Array.from(e.dataTransfer.files) as File[];

        handleFilesAdded(files);

    };



    const handleSubjectRangeFieldChange = (

        index: number,

        field: keyof Omit<SubjectRangeConfig, 'id'>,

        value: string

    ) => {

        setSubjectRanges(prev =>

            prev.map((range, idx) => {

                if (idx !== index) return range;

                if (field === 'name') {

                    return { ...range, name: value };

                }

                const numericValue = Math.max(0, parseInt(value, 10) || 0);

                return {

                    ...range,

                    [field]: numericValue

                } as SubjectRangeConfig;

            })

        );

    };



    const handleAddSubjectRange = () => {

        setSubjectRanges(prev => {

            const last = prev[prev.length - 1];

            const nextStartPage = last ? Math.max(1, last.endPage + 1) : 1;

            const nextQuestion = last ? Math.max(1, last.questionEnd + 1) : 1;



            return [

                ...prev,

                createSubjectRange({

                    startPage: nextStartPage,

                    endPage: nextStartPage,

                    questionStart: nextQuestion,

                    questionEnd: nextQuestion

                })

            ];

        });

    };



    const handleRemoveSubjectRange = (index: number) => {

        setSubjectRanges(prev => prev.filter((_, idx) => idx !== index));

    };



    const handleResetSubjectRanges = () => {

        setSubjectRanges(createDefaultSubjectRanges(certification));
    };


    const validateSubjectRanges = (): string | null => {

        if (subjectRanges.length === 0) {

            return '과목별 페이지 범위를 최소 1개 이상 입력해 주세요.';

        }



        for (let i = 0; i < subjectRanges.length; i++) {

            const range = subjectRanges[i];

            const label = `${i + 1}번 과목`;



            if (!range.name.trim()) {

                return `${label}: 과목명을 입력해 주세요.`;

            }

            if (range.startPage < 1 || range.endPage < 1) {

                return `${label}: 페이지 범위는 1페이지 이상이어야 합니다.`;

            }

            if (range.startPage > range.endPage) {

                return `${label}: 시작 페이지가 끝 페이지보다 큽니다.`;

            }

            if (range.questionStart < 1 || range.questionEnd < 1) {

                return `${label}: 문제 번호는 1번 이상이어야 합니다.`;

            }

            if (range.questionStart > range.questionEnd) {

                return `${label}: 문제 번호 범위를 확인해 주세요.`;

            }

        }



        return null;

    };





    const DIAGRAM_KEYWORDS = ["그림", "도면", "회로", "형상", "도식", "도표"];

    const convertPdfToImages = async (pdfFile: File): Promise<string[]> => {

        const arrayBuffer = await pdfFile.arrayBuffer();

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        const images: string[] = [];



        for (let i = 1; i <= pdf.numPages; i++) {

            const page = await pdf.getPage(i);

            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better quality

            const canvas = document.createElement('canvas');

            const context = canvas.getContext('2d');

            canvas.height = viewport.height;

            canvas.width = viewport.width;



            if (context) {

                await page.render({ canvasContext: context, viewport: viewport } as any).promise;

                // Get base64 string (remove data:image/jpeg;base64, prefix for API if needed, 

                // but here we keep it standard and let service handle it or strip it there)

                const base64 = canvas.toDataURL('image/jpeg', 0.8);

                images.push(base64);

            }

        }

        return images;

    };



    // Crop diagram from page image using coordinates

    const cropDiagram = (base64Image: string, bounds: { x: number, y: number, width: number, height: number }): Promise<string> => {

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

    const uploadXObjectsToStorage = async (objects: ExtractedImage[]): Promise<Map<string, string>> => {
        const urlMap = new Map<string, string>();
        if (objects.length === 0) {
            return urlMap;
        }

        const CHUNK_SIZE = 5;
        for (let i = 0; i < objects.length; i += CHUNK_SIZE) {
            const chunk = objects.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (obj) => {
                try {
                    const filename = generateUniqueFilename('jpg');
                    const url = await uploadXObjectImage(obj.dataUrl, filename);
                    urlMap.set(obj.id, url);
                } catch (error) {
                    console.error(`Failed to upload XObject ${obj.id}`, error);
                }
            }));
            const processed = Math.min(i + chunk.length, objects.length);
            setStatusMessage(`XObject 이미지 업로드 중... (${processed}/${objects.length})`);
        }

        return urlMap;
    };

    const fetchImageAsBase64 = async (url: string): Promise<string> => {
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

    const renderPdfPageToImage = async (source: PdfSourceMeta, globalPageIndex: number, scale: number = 2): Promise<string> => {
        if (pageImageDataRef.current.has(globalPageIndex)) {
            return pageImageDataRef.current.get(globalPageIndex)!;
        }

        const relativePageNumber = globalPageIndex - source.baseIndex;
        if (relativePageNumber < 0) {
            throw new Error('Invalid page reference for rendering.');
        }

        const pdfDoc = await pdfjsLib.getDocument({ data: source.data.slice() }).promise;
        const page = await pdfDoc.getPage(relativePageNumber + 1);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        if (!context) {
            throw new Error('Failed to get canvas context for PDF page');
        }

        await page.render({
            canvasContext: context,
            viewport
        } as any).promise;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        pdfDoc.cleanup?.();
        pdfDoc.destroy?.();
        pageImageDataRef.current.set(globalPageIndex, dataUrl);
        return dataUrl;
    };

    const uploadPreviewImagesToStorage = async (images: string[]): Promise<void> => {
        if (images.length === 0) return;
        const urlMap = pageImageUrlCacheRef.current;
        const CHUNK_SIZE = 4;
        for (let i = 0; i < images.length; i += CHUNK_SIZE) {
            const chunkIndices: number[] = [];
            const uploadPromises: Promise<string>[] = [];
            for (let j = 0; j < CHUNK_SIZE && i + j < images.length; j++) {
                const index = i + j;
                if (urlMap.has(index)) continue;
                chunkIndices.push(index);
                const filename = generateUniqueFilename('jpg');
                uploadPromises.push(uploadBase64Image(images[index], filename));
            }
            if (uploadPromises.length > 0) {
                setStatusMessage(`페이지 이미지 업로드 중... (${Math.min(i + CHUNK_SIZE, images.length)}/${images.length})`);
                const urls = await Promise.all(uploadPromises);
                urls.forEach((url, idx) => {
                    urlMap.set(chunkIndices[idx], url);
                });
            }
        }
    };

    const loadPreviewImagesFromJson = async (previewItems: any[]) => {
        if (!previewItems || previewItems.length === 0) {
            setPreviewImages([]);
            pageImageUrlCacheRef.current = new Map();
            return;
        }

        if (typeof previewItems[0] === 'string') {
            setPreviewImages(previewItems);
            pageImageUrlCacheRef.current = new Map();
            return;
        }

        const base64ByIndex = new Map<number, string>();
        const urlMap = new Map<number, string>();

        for (const item of previewItems) {
            if (typeof item !== 'object' || item === null) continue;
            if (typeof item.pageIndex !== 'number') continue;
            if (item.imageUrl) {
                urlMap.set(item.pageIndex, item.imageUrl);
                const dataUrl = item.imageUrl.startsWith('data:')
                    ? item.imageUrl
                    : await fetchImageAsBase64(item.imageUrl);
                base64ByIndex.set(item.pageIndex, dataUrl);
            } else if (item.dataUrl) {
                base64ByIndex.set(item.pageIndex, item.dataUrl);
            }
        }

        const indices = Array.from(base64ByIndex.keys());
        if (indices.length === 0) {
            setPreviewImages([]);
            pageImageUrlCacheRef.current = urlMap;
            return;
        }
        const maxIndex = Math.max(...indices);
        const base64List = new Array(maxIndex + 1).fill('');
        indices.sort((a, b) => a - b).forEach(idx => {
            base64List[idx] = base64ByIndex.get(idx)!;
        });
        setPreviewImages(base64List);
        pageImageUrlCacheRef.current = urlMap;
    };




    const handleProcessStart = async () => {
        if (selectedFiles.length === 0) return;

        const rangeValidationMessage = validateSubjectRanges();
        if (rangeValidationMessage) {
            setError(rangeValidationMessage);
            return;
        }

        cancelProcessingRef.current = false;
        setIsProcessing(true);
        setError(null);
        setExtractedQuestions([]);
        setGeneratedVariants([]);
        setPreviewImages([]);
        setQuestionPageMap(new Map());
        setQuestionDiagramMap(new Map());
        setXObjects([]);
        setCompletedSubjects([]);
        setPendingSubjects([]);
        setCurrentSubject(null);
        setIsPaused(false);
        setPendingSubjectPackage(null);
        setIsBatchConfirmed(false);
        pageImageDataRef.current = new Map();

        try {
            const allImages: string[] = [];
            const questionPageLookup = new Map<number, number>();
            const pdfSources: PdfSourceMeta[] = [];
            let detectedYear: number | null = null;
            let totalPdfPages = 0;
            let hasImageFiles = false;
            let hasPdfFiles = false;
            xObjectUrlCacheRef.current = new Map();

            if (selectedFiles.length > 0) {
                detectedYear = extractYearFromFilename(selectedFiles[0].name);
                if (detectedYear) {
                    setStatusMessage(`????? ?? ??: ${detectedYear} ?`);
                }
            }

            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                setStatusMessage(`?? ?? ?... (${i + 1}/${selectedFiles.length}): ${file.name} `);

                if (file.type === 'application/pdf') {
                    hasPdfFiles = true;
                    const arrayBuffer = await file.arrayBuffer();
                    const pdfBytes = new Uint8Array(arrayBuffer.byteLength);
                    pdfBytes.set(new Uint8Array(arrayBuffer));
                    const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
                    const pageCount = pdfDoc.numPages;
                    pdfSources.push({
                        file,
                        data: pdfBytes,
                        pageCount,
                        baseIndex: totalPdfPages
                    });
                    totalPdfPages += pageCount;
                    pdfDoc.cleanup?.();
                    pdfDoc.destroy?.();
                } else if (file.type.startsWith('image/')) {
                    hasImageFiles = true;
                    const base64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                    });
                    allImages.push(base64);
                } else {
                    setError(`???? ?? ?? ?????: ${file.name}`);
                    setIsProcessing(false);
                    return;
                }
            }

            const hasTextPages = pdfSources.length > 0;
            if (hasTextPages && hasImageFiles) {
                setError('??? ?? PDF ?? ? ??? ??? ??? ???? ???.');
                setIsProcessing(false);
                return;
            }

            const useTextMode = hasPdfFiles && !hasImageFiles;

            if (!useTextMode && allImages.length > 0) {
                await uploadPreviewImagesToStorage(allImages);
            }

            const yearInfo = detectedYear ? ` - ??: ${detectedYear} ?` : '';
            if (useTextMode) {
                setStatusMessage(`??? ?? PDF ${totalPdfPages}??? ?? ??${selectedSubject ? ` - ??: ${selectedSubject}` : ''}${yearInfo}`);
                setPreviewImages([]);
            } else {
                setStatusMessage(`AI? ${allImages.length}?? ???? ?? ?... (??? / ?? ??)${selectedSubject ? ` - ??: ${selectedSubject}` : ''}${yearInfo} `);
                setPreviewImages(allImages);
            }

            const allQuestions: QuestionModel[] = [];
            const pageMap = new Map<number, number>();
            const diagramMap = new Map<number, { pageIndex: number, bounds: { x: number, y: number, width: number, height: number } }>();
            const totalPages = useTextMode ? totalPdfPages : allImages.length;
            const buildSubjectPackage = (
                subjectName: string,
                startIndex: number,
                questionsSubset: QuestionModel[],
                previewMetadata: ReturnType<typeof createPreviewImageMetadata>
            ): SubjectProcessingPackage => {
                const questionCount = questionsSubset.length;
                const endIndex = startIndex + questionCount;
                const questionPageEntries = Array.from(pageMap.entries())
                    .filter(([qIdx]) => qIdx >= startIndex && qIdx < endIndex)
                    .map(([qIdx, pageIdx]) => [qIdx - startIndex, pageIdx] as [number, number]);

                const questionDiagramEntries = Array.from(diagramMap.entries())
                    .filter(([qIdx]) => qIdx >= startIndex && qIdx < endIndex)
                    .map(([qIdx, info]) => [qIdx - startIndex, info] as [number, typeof info]);

                return {
                    subjectName,
                    questions: questionsSubset,
                    questionPageMap: questionPageEntries,
                    questionDiagramMap: questionDiagramEntries,
                    previewImages: previewMetadata
                };
            };

            const resolveSubjectSegments = (startPage: number, endPage: number) => {
                if (!useTextMode) return [];
                const segments: Array<{
                    source: PdfSourceMeta;
                    start: number;
                    end: number;
                }> = [];
                pdfSources.forEach(source => {
                    const absoluteStart = source.baseIndex + 1;
                    const absoluteEnd = source.baseIndex + source.pageCount;
                    const overlapStart = Math.max(startPage, absoluteStart);
                    const overlapEnd = Math.min(endPage, absoluteEnd);
                    if (overlapStart <= overlapEnd) {
                        segments.push({
                            source,
                            start: overlapStart - absoluteStart + 1,
                            end: overlapEnd - absoluteStart + 1
                        });
                    }
                });
                return segments;
            };

            // If selectedSubject is set, skip subject ranges processing
            // This prevents conflicts between single subject mode and multi-subject range mode
            const shouldUseSubjectRanges = !selectedSubject;

            for (const subjectBatch of subjectRanges) {
                // Skip subject range processing if single subject mode is active
                if (!shouldUseSubjectRanges) {
                    console.log('[INFO] Skipping subject ranges because selectedSubject is active');
                    break;
                }

                if (cancelProcessingRef.current) {
                    setStatusMessage('??? ???? ??? ??????.');
                    setCurrentSubject(null);
                    break;
                }

                const subjectName = subjectBatch.name.trim();
                const currentIndex = subjectRanges.findIndex(range => range.id === subjectBatch.id);
                const isLastSubject = currentIndex === -1 || currentIndex === subjectRanges.length - 1;
                const safeStartPage = Math.max(1, subjectBatch.startPage);
                const safeEndPage = Math.max(safeStartPage, subjectBatch.endPage);

                if (safeStartPage > totalPages) continue;

                const startIdx = Math.max(0, safeStartPage - 1);
                const endIdx = Math.min(safeEndPage - 1, totalPages - 1);
                const displayStartPage = startIdx + 1;
                const displayEndPage = endIdx + 1;
                const minQuestionNumber = Math.max(1, subjectBatch.questionStart);
                const maxQuestionNumber = Math.max(minQuestionNumber, subjectBatch.questionEnd);

                setCurrentSubject(subjectName);

                if (useTextMode) {
                    const subjectSegments = resolveSubjectSegments(displayStartPage, displayEndPage);
                    if (subjectSegments.length === 0) {
                        continue;
                    }

                    const subjectTextPages: PdfPageText[] = [];
                    const subjectAnchorsByPage = new Map<number, PdfQuestionAnchor[]>();
                    const pageDimensions = new Map<number, { width: number; height: number }>();
                    const pageSourceMap = new Map<number, PdfSourceMeta>();
                    let subjectHasText = false;
                    const totalSegmentPages = subjectSegments.reduce((sum, seg) => sum + (seg.end - seg.start + 1), 0);
                    let processedTextPages = 0;

                    for (const segment of subjectSegments) {
                        const segmentPageCount = segment.end - segment.start + 1;
                        setStatusMessage(`${subjectName} 텍스트 추출 중... (${processedTextPages}/${totalSegmentPages}페이지)`);
                        const pages = await extractStructuredTextFromPdf(segment.source.data, {
                            start: segment.start,
                            end: segment.end
                        });
                        const adjustedPages = pages.map(page => ({
                            ...page,
                            pageIndex: page.pageIndex + segment.source.baseIndex
                        }));
                        adjustedPages.forEach(page => {
                            subjectTextPages.push(page);
                            subjectAnchorsByPage.set(page.pageIndex, page.questionAnchors);
                            pageDimensions.set(page.pageIndex, { width: page.width, height: page.height });
                            pageSourceMap.set(page.pageIndex, segment.source);
                            if (page.text && page.text.trim().length > 0) {
                                subjectHasText = true;
                            }
                            page.questionAnchors.forEach(anchor => {
                                if (!questionPageLookup.has(anchor.questionNumber)) {
                                    questionPageLookup.set(anchor.questionNumber, page.pageIndex);
                                }
                            });
                        });
                        processedTextPages += segmentPageCount;
                        setStatusMessage(`${subjectName} 텍스트 추출 중... (${processedTextPages}/${totalSegmentPages}페이지)`);
                    }

                    if (!subjectHasText) {
                        setStatusMessage('텍스트 기반이 아닌 PDF는 현재 처리할 수 없습니다.');
                        setError('PDF 내부에서 텍스트를 추출하지 못했습니다. 이미지/스캔 방식 PDF는 지원하지 않습니다.');
                        setIsProcessing(false);
                        return;
                    }

                    const orderedPages = [...subjectTextPages].sort((a, b) => a.pageIndex - b.pageIndex);
                    const subjectText = orderedPages
                        .map(page => `# Page ${page.pageIndex + 1}` + '\n' + page.text)
                        .join('\n\n');

                    if (!subjectText.trim()) {
                        continue;
                    }

                    setStatusMessage(`${subjectName} ?? ?... (${displayStartPage}~${displayEndPage}???, ??? ${orderedPages.length}???, ${minQuestionNumber}~${maxQuestionNumber}?)`);

                    setStatusMessage(`${subjectName} 분석 중 (Gemini ${currentIndex + 1}/${subjectRanges.length})`);
                    const textQuestions = await analyzeQuestionsFromText(subjectText);

                    console.log(`[DEBUG PDF] ${subjectName}: AI extracted ${textQuestions.length} questions from text`);

                    const filteredQuestions = textQuestions.filter(q => {
                        const detectedNumber = extractLeadingQuestionNumber(q.questionText);
                        if (detectedNumber !== null) {
                            const isInRange = detectedNumber >= minQuestionNumber && detectedNumber <= maxQuestionNumber;
                            console.log(`[DEBUG PDF] ${subjectName}, Q${detectedNumber}: ${isInRange ? 'KEEP' : 'FILTER OUT'} (range: ${minQuestionNumber}-${maxQuestionNumber})`);
                            return isInRange;
                        }
                        console.log(`[DEBUG PDF] ${subjectName}, No question number detected, keeping question`);
                        return true;
                    });

                    console.log(`[DEBUG PDF] ${subjectName}: Filtered to ${filteredQuestions.length} questions (from ${textQuestions.length})`);

                    const startIndex = allQuestions.length;
                    allQuestions.push(...filteredQuestions);

                    for (let idx = 0; idx < filteredQuestions.length; idx++) {
                        const q = filteredQuestions[idx];
                        const questionIdx = startIndex + idx;
                        const detectedNumber = extractLeadingQuestionNumber(q.questionText);

                        let pageIndexForQuestion = startIdx;
                        if (detectedNumber !== null && questionPageLookup.has(detectedNumber)) {
                            pageIndexForQuestion = questionPageLookup.get(detectedNumber)!;
                        }
                        pageMap.set(questionIdx, pageIndexForQuestion);

                        const needsDiagram = DIAGRAM_KEYWORDS.some(keyword => q.questionText.includes(keyword));
                        if (needsDiagram && detectedNumber !== null) {
                            const pageMeta = pageDimensions.get(pageIndexForQuestion);
                            const sourceMeta = pageSourceMap.get(pageIndexForQuestion);
                            if (pageMeta && sourceMeta) {
                                await renderPdfPageToImage(sourceMeta, pageIndexForQuestion);
                                diagramMap.set(questionIdx, {
                                    pageIndex: pageIndexForQuestion,
                                    bounds: {
                                        x: 0,
                                        y: 0,
                                        width: pageMeta.width,
                                        height: pageMeta.height
                                    }
                                });
                            }
                        }
                    }

                    const subjectData: any = {
                        subject: subjectName,
                        extractedQuestions: filteredQuestions,
                        pageRange: { start: displayStartPage, end: displayEndPage },
                        questionRange: { start: minQuestionNumber, end: maxQuestionNumber },
                        questionPageMap: Array.from(pageMap.entries()).filter(([qIdx]) =>
                            qIdx >= allQuestions.length - filteredQuestions.length
                        ),
                        questionDiagramMap: Array.from(diagramMap.entries()).filter(([qIdx]) =>
                            qIdx >= allQuestions.length - filteredQuestions.length
                        ),
                        xObjects: [],
                        previewImages: [],
                        subjectText,
                        savedAt: new Date().toISOString()
                    };

                    if (filteredQuestions.length > 0) {
                        const subjectPackage = buildSubjectPackage(
                            subjectName,
                            startIndex,
                            filteredQuestions,
                            [] // Empty preview metadata for text mode
                        );
                        setPendingSubjectPackage(subjectPackage);
                        setIsBatchConfirmed(false);
                    } else {
                        setPendingSubjectPackage(null);
                        setIsBatchConfirmed(true);
                    }

                    setExtractedQuestions(prev => [...prev, ...filteredQuestions]);
                    const blob = new Blob([JSON.stringify(subjectData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${subjectBatch.name}_${new Date().getTime()}.json`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    setCompletedSubjects(prev => [...prev, subjectName]);
                    setStatusMessage(`${subjectName} ??! (${filteredQuestions.length}??, ${minQuestionNumber}~${maxQuestionNumber}?) - JSON ?? ?????`);

                    const shouldPauseForNext = !processFirstSubjectOnly && !isLastSubject;

                    if (processFirstSubjectOnly) {
                        setStatusMessage(`빠른 테스트 모드: ${subjectName} 처리 완료`);
                        break;
                    }

                    if (shouldPauseForNext) {
                        setBatchConfirmationSubject(subjectName);
                        setIsBatchConfirmed(false);
                        setIsPaused(true);
                        const nextSubjects = subjectRanges.slice(Math.max(0, currentIndex + 1)).map(s => s.name);
                        setPendingSubjects(nextSubjects);

                        await new Promise<void>((resolve) => {
                            const checkPaused = setInterval(() => {
                                if (!isPausedRef.current || cancelProcessingRef.current) {
                                    clearInterval(checkPaused);
                                    resolve();
                                }
                            }, 150);
                        });

                        if (cancelProcessingRef.current) {
                            setStatusMessage('??? ???? ??? ??????.');
                            setCurrentSubject(null);
                            break;
                        }
                    }
                } else {
                    const subjectPages = allImages.slice(startIdx, endIdx + 1);
                    setStatusMessage(`${subjectName} ?? ?... (${displayStartPage}~${displayEndPage}???, ${subjectPages.length}?, ${minQuestionNumber}~${maxQuestionNumber}?)`);

                    const subjectQuestions: QuestionModel[] = [];
                    for (let idx = 0; idx < subjectPages.length; idx++) {
                        const pageIndex = startIdx + idx;
                        setStatusMessage(`${subjectName} 이미지 분석 중... (${idx + 1}/${subjectPages.length}페이지)`);
                        let questions: QuestionModel[] = [];
                        try {
                            questions = await analyzeQuestionsFromImages(
                                [subjectPages[idx]],
                                selectedSubject || undefined,
                                CERTIFICATION_SUBJECTS[certification]
                            );
                        } catch (err) {
                            console.error(`Error processing page ${pageIndex}:`, err);
                        }

                        const filteredQuestions = questions.filter(q => {
                            const detectedNumber = extractLeadingQuestionNumber(q.questionText);
                            if (detectedNumber !== null) {
                                const isInRange = detectedNumber >= minQuestionNumber && detectedNumber <= maxQuestionNumber;
                                console.log(`[DEBUG] Page ${pageIndex + 1}, Q${detectedNumber}: ${isInRange ? 'KEEP' : 'FILTER OUT'} (range: ${minQuestionNumber}-${maxQuestionNumber})`);
                                return isInRange;
                            }
                            console.log(`[DEBUG] Page ${pageIndex + 1}, No question number detected, keeping question`);
                            return true;
                        });

                        console.log(`[DEBUG] Page ${pageIndex + 1}: Extracted ${questions.length} questions, Filtered to ${filteredQuestions.length} questions`);

                        const startIndex = allQuestions.length;
                        allQuestions.push(...filteredQuestions);
                        subjectQuestions.push(...filteredQuestions);

                        filteredQuestions.forEach((q: any, localIdx) => {
                            pageMap.set(startIndex + localIdx, pageIndex);

                            if (q.diagramBounds) {
                                diagramMap.set(startIndex + localIdx, {
                                    pageIndex,
                                    bounds: q.diagramBounds
                                });
                            }
                        });
                    }

                    const subjectPreviewMetadata = createPreviewImageMetadata(
                        startIdx,
                        subjectPages,
                        pageImageUrlCacheRef.current
                    );

                    const subjectData = {
                        subject: subjectName,
                        extractedQuestions: subjectQuestions,
                        pageRange: { start: displayStartPage, end: displayEndPage },
                        questionRange: { start: minQuestionNumber, end: maxQuestionNumber },
                        questionPageMap: Array.from(pageMap.entries()).filter(([qIdx]) =>
                            qIdx >= allQuestions.length - subjectQuestions.length
                        ),
                        questionDiagramMap: Array.from(diagramMap.entries()).filter(([qIdx]) =>
                            qIdx >= allQuestions.length - subjectQuestions.length
                        ),
                        xObjects: [],
                        previewImages: subjectPreviewMetadata,
                        savedAt: new Date().toISOString()
                    };

                    if (subjectQuestions.length > 0) {
                        // Calculate the correct startIndex for this subject
                        const subjectStartIndex = allQuestions.length - subjectQuestions.length;

                        const subjectPackage = buildSubjectPackage(
                            subjectName,
                            subjectStartIndex,
                            subjectQuestions,
                            subjectPreviewMetadata
                        );
                        setPendingSubjectPackage(subjectPackage);
                        setIsBatchConfirmed(false);
                    } else {
                        setPendingSubjectPackage(null);
                        setIsBatchConfirmed(true);
                    }

                    setExtractedQuestions(prev => [...prev, ...subjectQuestions]);
                    const blob = new Blob([JSON.stringify(subjectData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${subjectBatch.name}_${new Date().getTime()}.json`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    setCompletedSubjects(prev => [...prev, subjectName]);
                    setStatusMessage(`${subjectName} ??! (${subjectQuestions.length}??, ${minQuestionNumber}~${maxQuestionNumber}?) - JSON ?? ?????`);

                    if (processFirstSubjectOnly) {
                        setStatusMessage(`빠른 테스트 모드: ${subjectName} 처리 완료`);
                        break;
                    }

                    if (!isLastSubject) {
                        setBatchConfirmationSubject(subjectName);
                        setIsBatchConfirmed(false);
                        setIsPaused(true);
                        const nextSubjects = subjectRanges.slice(Math.max(0, currentIndex + 1)).map(s => s.name);
                        setPendingSubjects(nextSubjects);

                        await new Promise<void>((resolve) => {
                            const checkPaused = setInterval(() => {
                                if (!isPausedRef.current || cancelProcessingRef.current) {
                                    clearInterval(checkPaused);
                                    resolve();
                                }
                            }, 150);
                        });

                        if (cancelProcessingRef.current) {
                            setStatusMessage('??? ???? ??? ??????.');
                            setCurrentSubject(null);
                            break;
                        }
                    }
                }
            }

            if (cancelProcessingRef.current) {
                return;
            }

            if (detectedYear) {
                allQuestions.forEach(q => {
                    q.year = detectedYear;
                });
            }

            setXObjects([]);
            setQuestionPageMap(pageMap);
            setQuestionDiagramMap(diagramMap);
            setExtractedQuestions(allQuestions);
            setStatusMessage(`?? ??! ${allQuestions.length}?? ??? ?????${detectedYear ? ` (${detectedYear}?)` : ''} `);

        } catch (err: any) {
            console.error(err);
            setError(err.message || '?? ? ??? ??????.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDownload = () => {

        const data = {

            extractedQuestions,

            generatedVariants,

            questionPageMap: Array.from(questionPageMap.entries()),

            questionDiagramMap: Array.from(questionDiagramMap.entries()),

            xObjects: createXObjectMetadata(xObjects, xObjectUrlCacheRef.current),

            previewImages: createPreviewImageMetadata(0, previewImages, pageImageUrlCacheRef.current), // Include preview images to allow full restoration

            savedAt: new Date().toISOString()

        };



        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');

        link.href = url;

        link.download = `exam_questions_${new Date().getTime()}.json`;

        document.body.appendChild(link);

        link.click();

        document.body.removeChild(link);

        URL.revokeObjectURL(url);

        setStatusMessage('파일이 다운로드 폴더에 저장되었습니다.');

    };



    const loadXObjectsFromJson = async (rawXObjects: any[]) => {
        if (!rawXObjects || rawXObjects.length === 0) {
            xObjectUrlCacheRef.current = new Map();
            setXObjects([]);
            return;
        }

        setStatusMessage('XObject 이미지 복원 중...');
        const reconstructed: ExtractedImage[] = [];
        const urlMap = new Map<string, string>();

        for (const item of rawXObjects) {
            if (item.imageUrl) {
                urlMap.set(item.id, item.imageUrl);
                try {
                    const dataUrl = await fetchImageAsBase64(item.imageUrl);
                    reconstructed.push({
                        id: item.id,
                        pageIndex: item.pageIndex,
                        x: item.x,
                        y: item.y,
                        width: item.width,
                        height: item.height,
                        dataUrl
                    });
                } catch (error) {
                    console.warn(`Failed to fetch XObject image (${item.id})`, error);
                }
            } else if (item.dataUrl) {
                reconstructed.push(item as ExtractedImage);
            }
        }

        const missingUploads = reconstructed.filter(obj => !urlMap.has(obj.id));
        if (missingUploads.length > 0) {
            const uploadedMap = await uploadXObjectsToStorage(missingUploads);
            uploadedMap.forEach((value, key) => urlMap.set(key, value));
        }

        xObjectUrlCacheRef.current = urlMap;
        setXObjects(reconstructed);
    };

    const handleLoadJson = (event: React.ChangeEvent<HTMLInputElement>) => {

        const file = event.target.files?.[0];

        if (!file) return;



        const reader = new FileReader();

        reader.onload = (e) => {

            (async () => {

                try {

                    const json = JSON.parse(e.target?.result as string);

                    if (json.extractedQuestions) {

                        setExtractedQuestions(json.extractedQuestions);

                        setGeneratedVariants(json.generatedVariants || []);



                        if (json.questionPageMap) {

                            setQuestionPageMap(new Map(json.questionPageMap));

                        }

                        if (json.questionDiagramMap) {

                            setQuestionDiagramMap(new Map(json.questionDiagramMap));

                        }

                        if (json.xObjects) {

                            await loadXObjectsFromJson(json.xObjects);

                        } else {

                            xObjectUrlCacheRef.current = new Map();

                            setXObjects([]);

                        }

                        if (json.previewImages) {

                            await loadPreviewImagesFromJson(json.previewImages);

                        } else {
                            setPreviewImages([]);
                            pageImageUrlCacheRef.current = new Map();
                        }



                        setStatusMessage(`JSON 파일 로드 완료: ${json.extractedQuestions.length} 문제`);

                        setIsSaveCompleted(false); // Enable save button

                    }

                } catch (err) {

                    console.error('Failed to parse JSON', err);

                    alert('JSON 파일 형식이 올바르지 않습니다.');

                }

            })();

        };

        reader.readAsText(file);

        event.target.value = '';

    };



    const handleSaveCurrentSubject = async () => {
        if (isSavingSubject || !pendingSubjectPackage) {
            if (!pendingSubjectPackage) {
                setError('저장할 과목 데이터가 없습니다.');
            }
            return;
        }

        setIsSavingSubject(true);
        setError(null);

        try {
            const { subjectName, questions, questionPageMap, questionDiagramMap, previewImages: previewMeta } = pendingSubjectPackage;
            setStatusMessage(`${subjectName} - Supabase 저장 준비 중...`);

            const questionPageMapLocal = new Map<number, number>(questionPageMap);
            const questionDiagramMapLocal = new Map<number, { pageIndex: number; bounds: { x: number; y: number; width: number; height: number } }>(questionDiagramMap);

            const pageUrlMap = new Map<number, string>();
            const pageBase64Map = new Map<number, string>();
            for (const preview of previewMeta) {
                let base64 = preview.dataUrl || '';
                if (!base64 && preview.imageUrl) {
                    base64 = await fetchImageAsBase64(preview.imageUrl);
                }
                if (base64) {
                    pageBase64Map.set(preview.pageIndex, base64);
                }

                if (preview.imageUrl) {
                    pageUrlMap.set(preview.pageIndex, preview.imageUrl);
                } else if (base64) {
                    const filename = generateUniqueFilename('jpg');
                    const url = await uploadBase64Image(base64, filename);
                    pageUrlMap.set(preview.pageIndex, url);
                    pageImageUrlCacheRef.current.set(preview.pageIndex, url);
                }
            }

            for (const pageIdx of questionPageMapLocal.values()) {
                if (pageIdx === undefined) continue;
                if (!pageBase64Map.has(pageIdx)) {
                    const cached = pageImageDataRef.current.get(pageIdx);
                    if (cached) {
                        pageBase64Map.set(pageIdx, cached);
                    }
                }

                if (!pageUrlMap.has(pageIdx) && pageBase64Map.has(pageIdx)) {
                    const base64 = pageBase64Map.get(pageIdx)!;
                    const filename = generateUniqueFilename('jpg');
                    const url = await uploadBase64Image(base64, filename);
                    pageUrlMap.set(pageIdx, url);
                    pageImageUrlCacheRef.current.set(pageIdx, url);
                }
            }

            const diagramUrlMap = new Map<number, string>();
            const subjectDiagramKeys = Array.from(questionDiagramMapLocal.keys());
            if (subjectDiagramKeys.length > 0) {
                setStatusMessage(`${subjectName} - 다이어그램 업로드 중... (${subjectDiagramKeys.length}개)`);
                for (const questionIdx of subjectDiagramKeys) {
                    const diagramInfo = questionDiagramMapLocal.get(questionIdx);
                    if (!diagramInfo) continue;
                    const bounds = diagramInfo.bounds;
                    const pageIndex = diagramInfo.pageIndex;
                    let finalDiagramBase64 = '';
                    let pageBase64 = pageBase64Map.get(pageIndex);
                    if (!pageBase64) {
                        pageBase64 = pageImageDataRef.current.get(pageIndex);
                        if (pageBase64) {
                            pageBase64Map.set(pageIndex, pageBase64);
                        }
                    }
                    if (pageBase64) {
                        finalDiagramBase64 = await cropDiagram(pageBase64, bounds);
                    }

                    if (!finalDiagramBase64) {
                        console.warn(`Diagram for question ${questionIdx} skipped (no source image).`);
                        continue;
                    }

                    const filename = generateUniqueFilename('jpg');
                    const diagramUrl = await uploadDiagramImage(finalDiagramBase64, filename);
                    diagramUrlMap.set(questionIdx, diagramUrl);
                }
            }

            setStatusMessage(`${subjectName} - Supabase 저장 중... (${questions.length}문제)`);
            for (let i = 0; i < questions.length; i++) {
                const pageIdx = questionPageMapLocal.get(i);
                const imageUrl = pageIdx !== undefined ? pageUrlMap.get(pageIdx) : undefined;
                const diagramUrl = diagramUrlMap.get(i);

                // Remove id field and prepare for database insert
                const { id, diagramBounds, ...questionData } = questions[i];

                const questionToSave = {
                    ...questionData,
                    subject: selectedSubject || questions[i].subject,
                    imageUrl: imageUrl || null,
                    diagramUrl: diagramUrl || null,
                    certification,
                    // Convert arrays to proper format
                    options: questions[i].options,
                    topicKeywords: questions[i].topicKeywords || null,
                };

                const { error: saveError } = await supabase
                    .from('questions')
                    .insert(questionToSave);

                if (saveError) throw saveError;
            }

            setStatusMessage(`${subjectName} 저장 완료! (${questions.length}개 문제)`);
            setIsBatchConfirmed(true);
            setPendingSubjectPackage(null);
        } catch (error) {
            console.error('Subject save error:', error);
            const message = error instanceof Error ? error.message : '과목 저장 중 오류가 발생했습니다.';
            setError(message);
        } finally {
            setIsSavingSubject(false);
        }
    };

    const handleSaveAll = async () => {

        setIsProcessing(true);

        setError(null);

        let successCount = 0;



        try {

            setStatusMessage('이미지 업로드 및 중복 제거 중...');



            // 1. Upload unique images first

            // Identify which pages are actually used by questions

            const usedPageIndices = new Set(questionPageMap.values());

            const pageUrlMap = new Map<number, string>(); // Page Index -> Uploaded URL



            const uniquePages = Array.from(usedPageIndices);

            const totalPages = uniquePages.length;



            // Upload images in parallel chunks

            const UPLOAD_CONCURRENCY = 5;

            for (let i = 0; i < totalPages; i += UPLOAD_CONCURRENCY) {

                const batch = uniquePages.slice(i, i + UPLOAD_CONCURRENCY);

                await Promise.all(batch.map(async (pageIdx: number) => {

                    try {

                        const base64 = previewImages[pageIdx];

                        if (base64) {

                            const filename = generateUniqueFilename('jpg');

                            const url = await uploadBase64Image(base64, filename);

                            pageUrlMap.set(pageIdx, url);

                        }

                    } catch (e) {

                        console.error(`Failed to upload image for page ${pageIdx}`, e);

                    }

                }));

                setStatusMessage(`이미지 업로드 중... (${Math.min(i + UPLOAD_CONCURRENCY, totalPages)}/${totalPages})`);

            }



            // 2. Crop and upload diagrams

            const diagramUrlMap = new Map<number, string>(); // Question Index -> Diagram URL

            const questionsWithDiagrams: number[] = Array.from(questionDiagramMap.keys());



            if (questionsWithDiagrams.length > 0) {

                setStatusMessage(`다이어그램 추출 및 업로드 중... (${questionsWithDiagrams.length}개)`);



                for (const questionIdx of questionsWithDiagrams) {

                    try {

                        const diagramInfo = questionDiagramMap.get(questionIdx);

                        if (diagramInfo) {

                            const pageImage = previewImages[diagramInfo.pageIndex];

                            if (pageImage) {

                                // Crop diagram from page image

                                let finalDiagramBase64 = '';



                                // Try to find matching XObject first

                                // Check for overlap: XObject center is inside bounds

                                const bounds = diagramInfo.bounds;

                                const centerX = bounds.x + bounds.width / 2;

                                const centerY = bounds.y + bounds.height / 2;



                                const match = xObjects.find(obj =>

                                    obj.pageIndex === diagramInfo.pageIndex &&

                                    centerX >= obj.x && centerX <= (obj.x + obj.width) &&

                                    centerY >= obj.y && centerY <= (obj.y + obj.height)

                                );



                                if (match) {

                                    console.log(`Found matching XObject for question ${questionIdx}`);

                                    finalDiagramBase64 = match.dataUrl;

                                } else {

                                    console.log(`No XObject match for question ${questionIdx}, cropping...`);

                                    finalDiagramBase64 = await cropDiagram(pageImage, bounds);

                                }



                                // Upload cropped diagram or XObject

                                const filename = generateUniqueFilename('jpg');

                                const diagramUrl = await uploadDiagramImage(finalDiagramBase64, filename);

                                diagramUrlMap.set(questionIdx, diagramUrl);



                                console.log(`Diagram uploaded for question ${questionIdx}:`, diagramUrl);

                            }

                        }

                    } catch (e) {

                        console.error(`Failed to crop/upload diagram for question ${questionIdx}:`, e);

                        // Continue with other diagrams

                    }

                }

            }



            setStatusMessage(`문제 저장 중... (변형 문제 생성: ${generateVariants ? 'ON' : 'OFF'})`);



            // 3. Save questions

            for (let i = 0; i < extractedQuestions.length; i++) {

                const question = extractedQuestions[i];

                const pageIdx = questionPageMap.get(i);

                const imageUrl = pageIdx !== undefined ? pageUrlMap.get(pageIdx) : undefined;

                const diagramUrl = diagramUrlMap.get(i);



                const questionToSave = {

                    ...question,

                    subject: selectedSubject || question.subject,

                    imageUrl,

                    diagramUrl,

                    certification: certification,

                    // textFileUrl is removed as it's redundant

                };



                const { error: saveError } = await supabase

                    .from('questions')

                    .insert(questionToSave);



                if (saveError) throw saveError;

                successCount++;

            }



            setStatusMessage(`저장 완료! (${successCount}개 문제)`);

            setIsSaveCompleted(true);



        } catch (err: any) {

            console.error('Failed to save questions:', err);

            setError(err.message || '문제 저장 중 오류가 발생했습니다.');

        } finally {

            setIsProcessing(false);

        }

    };



    if (!isAdmin(session)) {

        return <div className="p-8 text-center">관리자 권한이 필요합니다.</div>;

    }



    return (

        <div className="space-y-6 max-w-4xl mx-auto">

            <div className="flex justify-between items-center border-b pb-4">

                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">

                    AI 문제 생성기 (PDF/이미지)

                </h2>

                <div className="flex gap-2">

                    <label className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md text-sm font-medium cursor-pointer">

                        JSON 불러오기

                        <input

                            type="file"

                            accept=".json"

                            onChange={handleLoadJson}

                            className="hidden"

                        />

                    </label>

                    {(extractedQuestions.length > 0 || generatedVariants.length > 0) && (

                        <button

                            onClick={handleDownload}

                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium"

                        >

                            결과 저장 (JSON)

                        </button>

                    )}

                    <button onClick={() => navigate('dashboard')} className="text-blue-500 hover:underline">

                        나가기

                    </button>

                </div>

            </div>



            {/* Subject Progress Display */}

            {currentSubject && (

                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-700">

                    <div className="flex items-center justify-between mb-2">

                        <h3 className="font-bold text-blue-800 dark:text-blue-300">

                            🔄 현재 처리 중: {currentSubject}

                        </h3>

                        <span className="text-sm text-blue-600 dark:text-blue-400">

                            {completedSubjects.length} / {subjectRanges.length} 과목 완료

                        </span>

                    </div>

                    {completedSubjects.length > 0 && (

                        <p className="text-sm text-blue-700 dark:text-blue-300">

                            ✅ 완료: {completedSubjects.join(', ')}

                        </p>

                    )}

                </div>

            )}



            {/* Confirmation Dialog */}

            {isPaused && (

                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">

                    <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-2xl max-w-md w-full mx-4 border-2 border-blue-500">

                        <div className="text-center mb-6">

                            <div className="text-5xl mb-4">✅</div>

                            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">

                                {completedSubjects[completedSubjects.length - 1]} 완료!

                            </h3>

                            <p className="text-slate-600 dark:text-slate-400">

                                JSON 파일이 다운로드되었습니다.

                            </p>

                        </div>



                        {pendingSubjects.length > 0 && (

                            <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">

                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">

                                    남은 과목:

                                </p>

                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">

                                    {pendingSubjects.join(', ')}

                                </p>

                            </div>

                        )}



                        <div className="flex gap-3">

                            <div className="mb-6 text-left">
                                <p className="text-slate-700 dark:text-slate-200 text-sm mb-2">
                                    JSON 파일은 자동으로 저장/다운로드되었습니다.
                                </p>
                                <div className="p-4 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
                                        Supabase Batch 저장을 진행해 주세요.
                                    </p>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={handleSaveCurrentSubject}
                                            disabled={isSavingSubject || isBatchConfirmed || !pendingSubjectPackage}
                                            className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${isBatchConfirmed
                                                ? 'bg-green-100 border-green-500 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                                                : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-700'
                                                }`}
                                            type="button"
                                        >
                                            {isBatchConfirmed
                                                ? '저장 완료됨'
                                                : isSavingSubject
                                                    ? 'Supabase 저장 중...'
                                                    : 'Supabase에 저장'}
                                        </button>
                                        {!isBatchConfirmed && !isSavingSubject && (
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                저장이 완료되면 자동으로 다음 과목을 진행할 수 있습니다.
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => setIsPaused(false)}
                                disabled={!isBatchConfirmed}
                                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-transform transform hover:scale-105"
                            >
                                다음 과목 진행
                            </button>
                            <button
                                onClick={() => {
                                    setIsPaused(false);
                                    setIsProcessing(false);
                                    setCurrentSubject(null);
                                    setPendingSubjects([]);
                                    cancelProcessingRef.current = true;
                                    setIsBatchConfirmed(false);
                                    setPendingSubjectPackage(null);
                                }}
                                className="flex-1 bg-slate-300 hover:bg-slate-400 text-slate-700 font-bold py-3 px-6 rounded-lg transition-transform transform hover:scale-105"
                            >
                                중단
                            </button>
                        </div>

                    </div>

                </div>

            )}



            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">

                <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">

                    <span className="text-slate-700 dark:text-slate-300 font-medium mb-2 block">

                        1. 출제 기준 업로드 (선택 사항 - 해당 과목의 출제 기준 PDF/이미지)

                    </span>

                    <div className="space-y-3">

                        <div className="flex items-center gap-2 flex-wrap">

                            <input

                                type="file"

                                accept="application/pdf,image/*"

                                multiple

                                onChange={handleStandardFileChange}

                                className="block w-full text-sm text-slate-500

                                    file:mr-4 file:py-2 file:px-4

                                    file:rounded-full file:border-0

                                    file:text-sm file:font-semibold

                                    file:bg-blue-50 file:text-blue-700

                                    hover:file:bg-blue-100

                                "

                            />

                            <button

                                onClick={handleUploadStandard}

                                disabled={standardFiles.length === 0 || !selectedSubject || isUploadingStandard}

                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"

                            >

                                {isUploadingStandard ? '저장 중...' : '출제 기준 저장'}

                            </button>

                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400">

                            * PDF 또는 이미지(JPG, PNG 등)를 여러 개 선택하여 업로드해주세요.

                        </p>

                        {standardFiles.length > 0 && (

                            <div className="space-y-2 max-h-48 overflow-y-auto">

                                {standardFiles.map((file, index) => (

                                    <div

                                        key={`${file.name}-${index}`}

                                        className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-600"

                                    >

                                        <div className="flex-1 min-w-0">

                                            <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">

                                                {file.name}

                                            </div>

                                            <div className="text-xs text-slate-500 dark:text-slate-400">

                                                {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type === 'application/pdf' ? 'PDF' : '이미지'}

                                            </div>

                                        </div>

                                        <button

                                            type="button"

                                            onClick={() => removeStandardFile(index)}

                                            className="ml-2 p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 rounded"

                                            title="삭제"

                                        >

                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />

                                            </svg>

                                        </button>

                                    </div>

                                ))}

                            </div>

                        )}

                    </div>

                    {!selectedSubject && (

                        <p className="text-xs text-red-500 mt-1">

                            * 출제 기준을 업로드하려면 2번 메뉴에서 먼저 과목을 선택해야 합니다.

                        </p>

                    )}

                </div>

                <label className="block mb-4">

                    <span className="text-slate-700 dark:text-slate-300 font-medium">2. 과목 선택 (선택 사항 - 정확도 향상)</span>

                    <select

                        value={selectedSubject || ''}

                        onChange={(e) => setSelectedSubject(e.target.value || null)}

                        className="mt-1 block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"

                    >

                        <option value="">과목 자동 인식 (AI)</option>

                        {CERTIFICATION_SUBJECTS[certification].map((subject, idx) => (

                            <option key={idx} value={subject}>

                                {subject}

                            </option>

                        ))}

                    </select>

                </label>



                {/* Subject Range Builder */}

                <div className="mb-6">

                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">

                        <span className="text-slate-700 dark:text-slate-300 font-medium">

                            3. 과목별 페이지/문항 범위 (페이지 중첩 허용)

                        </span>

                        <div className="flex gap-2 flex-wrap">

                            <button

                                type="button"

                                onClick={handleResetSubjectRanges}

                                className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-md hover:bg-slate-50 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700"

                            >

                                기본 템플릿

                            </button>

                            <button

                                type="button"

                                onClick={handleAddSubjectRange}

                                className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50 dark:text-blue-300 dark:border-blue-500 dark:hover:bg-blue-900/20"

                            >

                                과목 추가

                            </button>

                        </div>

                    </div>

                    {selectedSubject && (
                        <div className="mt-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                            <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                ⚠️ <strong>과목 선택</strong>이 활성화되어 있습니다. 과목별 범위 설정은 무시됩니다.
                            </p>
                        </div>
                    )}

                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">

                        예) 전기자기학 1~3페이지/1~20번, 전력공학 3~5페이지/21~40번처럼 한 페이지를 여러 과목에 배정할 수 있습니다.

                    </p>
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="quick-test-toggle"
                            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                            checked={processFirstSubjectOnly}
                            onChange={(e) => setProcessFirstSubjectOnly(e.target.checked)}
                        />
                        <label
                            htmlFor="quick-test-toggle"
                            className="text-sm text-slate-600 dark:text-slate-300"
                        >
                            빠른 테스트 모드 (첫 과목만 처리)
                        </label>
                    </div>

                    <div className={`space-y-3 mt-4 ${selectedSubject ? 'opacity-50 pointer-events-none' : ''}`}>

                        {subjectRanges.map((range, index) => (

                            <div

                                key={range.id}

                                className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"

                            >

                                <div className="flex items-center justify-between mb-3">

                                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">

                                        {index + 1}. {range.name || '과목'}

                                    </div>

                                    <button

                                        type="button"

                                        onClick={() => handleRemoveSubjectRange(index)}

                                        className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"

                                    >

                                        삭제

                                    </button>

                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">

                                    <div className="md:col-span-4">

                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">

                                            과목명

                                        </label>

                                        <input

                                            type="text"

                                            value={range.name}

                                            onChange={(e) => handleSubjectRangeFieldChange(index, 'name', e.target.value)}

                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"

                                        />

                                    </div>

                                    <div className="md:col-span-4">

                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">

                                            페이지 범위

                                        </label>

                                        <div className="flex items-center gap-2">

                                            <input

                                                type="number"

                                                min={1}

                                                value={range.startPage || ''}

                                                onChange={(e) => handleSubjectRangeFieldChange(index, 'startPage', e.target.value)}

                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"

                                            />

                                            <span className="text-slate-500 dark:text-slate-400">~</span>

                                            <input

                                                type="number"

                                                min={1}

                                                value={range.endPage || ''}

                                                onChange={(e) => handleSubjectRangeFieldChange(index, 'endPage', e.target.value)}

                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"

                                            />

                                        </div>

                                    </div>

                                    <div className="md:col-span-4">

                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">

                                            문제 번호 범위

                                        </label>

                                        <div className="flex items-center gap-2">

                                            <input

                                                type="number"

                                                min={1}

                                                value={range.questionStart || ''}

                                                onChange={(e) => handleSubjectRangeFieldChange(index, 'questionStart', e.target.value)}

                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"

                                            />

                                            <span className="text-slate-500 dark:text-slate-400">~</span>

                                            <input

                                                type="number"

                                                min={1}

                                                value={range.questionEnd || ''}

                                                onChange={(e) => handleSubjectRangeFieldChange(index, 'questionEnd', e.target.value)}

                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"

                                            />

                                        </div>

                                    </div>

                                </div>

                            </div>

                        ))}

                    </div>

                </div>



                {/* Drag and Drop Zone */}

                <div className="mb-4">

                    <span className="text-slate-700 dark:text-slate-300 font-medium mb-2 block">4. 기출문제 파일 업로드 (PDF 또는 이미지)</span>



                    <div

                        onDragEnter={handleDragEnter}

                        onDragLeave={handleDragLeave}

                        onDragOver={handleDragOver}

                        onDrop={handleDrop}

                        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragging

                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'

                            : 'border-slate-300 dark:border-slate-600 hover:border-blue-400'

                            } `}

                    >

                        <input

                            type="file"

                            accept="image/jpeg,image/png,image/webp,application/pdf"

                            multiple

                            onChange={handleFileChange}

                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"

                            id="file-upload"

                        />

                        <label htmlFor="file-upload" className="cursor-pointer">

                            <div className="flex flex-col items-center gap-2">

                                <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />

                                </svg>

                                <div className="text-slate-600 dark:text-slate-400">

                                    <span className="font-semibold text-blue-600 dark:text-blue-400">파일을 선택</span>하거나 여기에 드래그하세요

                                </div>

                                <div className="text-sm text-slate-500">

                                    JPG, PNG, WebP, PDF • 최대 {MAX_FILES}개 • 파일당 최대 10MB

                                </div>

                            </div>

                        </label>

                    </div>

                </div>



                {/* Selected Files List */}

                {

                    selectedFiles.length > 0 && (

                        <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">

                            <div className="flex justify-between items-center mb-3">

                                <span className="font-medium text-slate-700 dark:text-slate-300">

                                    선택된 파일 ({selectedFiles.length}/{MAX_FILES})

                                </span>

                                <button

                                    onClick={handleClearAll}

                                    className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"

                                >

                                    전체 삭제

                                </button>

                            </div>

                            <div className="space-y-2 max-h-60 overflow-y-auto">

                                {selectedFiles.map((file, index) => (

                                    <div

                                        key={index}

                                        className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-600"

                                    >

                                        <div className="flex items-center gap-2 flex-1 min-w-0">

                                            <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />

                                            </svg>

                                            <div className="flex-1 min-w-0">

                                                <div className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">

                                                    {file.name}

                                                </div>

                                                <div className="text-xs text-slate-500">

                                                    {(file.size / 1024 / 1024).toFixed(2)} MB

                                                </div>

                                            </div>

                                        </div>

                                        <button

                                            onClick={() => handleRemoveFile(index)}

                                            className="ml-2 p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"

                                            title="삭제"

                                        >

                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />

                                            </svg>

                                        </button>

                                    </div>

                                ))}

                            </div>

                        </div>

                    )

                }



                {

                    error && (

                        <div className="p-3 mb-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md text-sm whitespace-pre-line">

                            {error}

                        </div>

                    )

                }



                <button

                    onClick={handleProcessStart}

                    disabled={selectedFiles.length === 0 || isProcessing}

                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"

                >

                    {isProcessing ? statusMessage : `파일 분석 및 문제 추출 시작(${selectedFiles.length}개 파일)`}

                </button>

            </div >







            {

                previewImages.length > 0 && (

                    <div className="space-y-4">

                        <h3 className="text-xl font-bold">업로드된 이미지 미리보기 ({previewImages.length})</h3>

                        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">

                            {previewImages.map((img, idx) => (

                                <div key={idx} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">

                                    <div className="bg-slate-100 dark:bg-slate-900 px-3 py-1 text-xs font-medium text-slate-500 border-b border-slate-200 dark:border-slate-700">

                                        Page {idx + 1}

                                    </div>

                                    <img src={img.startsWith('data:') ? img : `data: image / jpeg; base64, ${img} `} alt={`Preview ${idx + 1} `} className="w-full h-auto" />

                                </div>

                            ))}

                        </div>

                    </div>

                )

            }



            {

                extractedQuestions.length > 0 && (

                    <div className="space-y-6">

                        <div className="flex justify-between items-center">

                            <h3 className="text-xl font-bold">추출된 문제 ({extractedQuestions.length})</h3>

                            <div className="flex items-center gap-4">

                                <label className="flex items-center gap-2 cursor-pointer">

                                    <input

                                        type="checkbox"

                                        checked={generateVariants}

                                        onChange={(e) => setGenerateVariants(e.target.checked)}

                                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"

                                    />

                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">

                                        변형 문제 자동 생성 (시간 소요됨)

                                    </span>

                                </label>

                                <button

                                    onClick={handleSaveAll}

                                    disabled={isProcessing || isSaveCompleted}

                                    className={`px-4 py-2 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors ${isSaveCompleted

                                        ? 'bg-gray-500'

                                        : 'bg-green-600 hover:bg-green-700'

                                        } `}

                                >

                                    {isSaveCompleted ? (

                                        <>

                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />

                                            </svg>

                                            저장 완료

                                        </>

                                    ) : isProcessing ? (

                                        <>

                                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">

                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>

                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>

                                            </svg>

                                            {statusMessage || '처리 중...'}

                                        </>

                                    ) : (

                                        '전체 저장 (Batch)'

                                    )}

                                </button>

                            </div>

                        </div>



                        <div className="grid gap-6">

                            {extractedQuestions.map((q, idx) => (

                                <div key={idx} className="bg-slate-50 dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">

                                    <div className="flex justify-between mb-2">

                                        <span className="text-xs font-bold px-2 py-1 bg-blue-100 text-blue-800 rounded">

                                            {q.subject}

                                        </span>

                                        <span className="text-xs text-slate-500">Q{idx + 1}</span>

                                    </div>

                                    <div className="font-medium mb-3 text-slate-800 dark:text-slate-200 break-words overflow-wrap-anywhere">

                                        <FormattedText text={q.questionText} />

                                        {questionDiagramMap.has(idx) && (

                                            <div className="mt-2 mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800 flex items-center gap-2">

                                                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />

                                                </svg>

                                                <span className="text-xs font-bold text-blue-700 dark:text-blue-300">

                                                    다이어그램 감지됨 (저장 시 이미지 생성)

                                                </span>

                                            </div>

                                        )}

                                    </div>

                                    <ul className="space-y-1 mb-3">

                                        {q.options.map((opt, i) => (

                                            <li key={i} className={`text-sm p-2 rounded break-words overflow-wrap-anywhere ${i === q.answerIndex ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-white dark:bg-slate-800'} `}>

                                                <span className="font-bold mr-2">{['A', 'B', 'C', 'D'][i]}.</span>

                                                <FormattedText text={opt} />

                                            </li>

                                        ))}

                                    </ul>

                                    <div className="text-sm text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-3 rounded break-words overflow-wrap-anywhere">

                                        <strong>해설:</strong> <FormattedText text={q.aiExplanation || ''} />

                                    </div>

                                </div>

                            ))}

                        </div>

                    </div>

                )

            }



            {

                generatedVariants.length > 0 && (

                    <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-700">

                        <h3 className="text-xl font-bold mb-4">생성된 변형 문제 ({generatedVariants.length})</h3>

                        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">

                            <p className="text-yellow-800 dark:text-yellow-200 text-sm">

                                변형 문제는 자동으로 데이터베이스에 저장되었습니다. 이제 퀴즈 모드에서 확인할 수 있습니다.

                            </p>

                        </div>

                    </div>

                )

            }

        </div >

    );

};



export default AiVariantGeneratorScreen;
const createPreviewImageMetadata = (
    startIdx: number,
    pages: string[],
    urlMap: Map<number, string>
) => {
    return pages.map((base64, idx) => {
        const pageIndex = startIdx + idx;
        const imageUrl = urlMap.get(pageIndex);
        if (imageUrl) {
            return { pageIndex, imageUrl };
        }
        return { pageIndex, dataUrl: base64 };
    });
};
