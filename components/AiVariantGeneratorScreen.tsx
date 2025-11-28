import React, { useState, useEffect } from 'react';
import { Screen, QuestionModel, AuthSession } from '../types';
import { analyzeQuestionsFromText, generateFiveVariants, analyzeQuestionsFromImages, extractTextFromImages } from '../services/geminiService';
import { quizApi } from '../services/quizApi';
import FormattedText from './FormattedText';
import { isAdmin } from '../services/authService';
import { uploadBase64Image, uploadTextFile, uploadDiagramImage, generateUniqueFilename, uploadToStorage } from '../services/storageService';
import * as pdfjsLib from 'pdfjs-dist';
import { Certification, CERTIFICATION_SUBJECTS } from '../constants';
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
        return sections;
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

const renderPdfPageToImage = async (page: any, scale: number = 2): Promise<string> => {
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

    return canvas.toDataURL('image/jpeg', 0.9);
};

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
    const [generateVariants, setGenerateVariants] = useState(false);

    // Standard upload state
    const [standardFiles, setStandardFiles] = useState<File[]>([]);
    const [isUploadingStandard, setIsUploadingStandard] = useState(false);

    const handleStandardFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files) {
            return;
        }

        const incomingFiles = Array.from(event.target.files);
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

                        if (!pageText) {
                            try {
                                const pageImage = await renderPdfPageToImage(page);
                                const ocrText = await extractTextFromImages([pageImage]);
                                pageText = ocrText.trim();
                            } catch (ocrError) {
                                console.error(`OCR fallback failed for standard PDF page ${i}`, ocrError);
                            }
                        }

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

    const handleProcessStart = async () => {
        if (selectedFiles.length === 0) return;

        setIsProcessing(true);
        setError(null);
        setExtractedQuestions([]);
        setGeneratedVariants([]);
        setPreviewImages([]);
        setQuestionPageMap(new Map());
        setQuestionDiagramMap(new Map());

        try {
            let allImages: string[] = [];
            let detectedYear: number | null = null;

            // Extract year from first filename
            if (selectedFiles.length > 0) {
                detectedYear = extractYearFromFilename(selectedFiles[0].name);
                if (detectedYear) {
                    setStatusMessage(`파일명에서 연도 감지: ${detectedYear} 년`);
                }
            }

            // Process each file
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                setStatusMessage(`파일 처리 중... (${i + 1}/${selectedFiles.length}): ${file.name} `);

                let images: string[] = [];

                if (file.type === 'application/pdf') {
                    images = await convertPdfToImages(file);
                } else if (file.type.startsWith('image/')) {
                    const base64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                    });
                    images = [base64];
                }

                allImages.push(...images);
            }

            const yearInfo = detectedYear ? ` - 연도: ${detectedYear} 년` : '';
            setStatusMessage(`AI가 ${allImages.length}개의 이미지를 분석 중... (회로도 / 수식 인식)${selectedSubject ? ` - 과목: ${selectedSubject}` : ''}${yearInfo} `);
            setPreviewImages(allImages);

            // Process pages individually (or in small parallel batches) to maintain Page -> Question mapping
            const CONCURRENT_LIMIT = 3; // Process 3 pages at a time
            const allQuestions: QuestionModel[] = [];
            const pageMap = new Map<number, number>(); // Question Index -> Page Index
            const diagramMap = new Map<number, { pageIndex: number, bounds: { x: number, y: number, width: number, height: number } }>(); // Question Index -> Diagram Info

            for (let i = 0; i < allImages.length; i += CONCURRENT_LIMIT) {
                const batchPromises = [];
                for (let j = 0; j < CONCURRENT_LIMIT && i + j < allImages.length; j++) {
                    const pageIndex = i + j;
                    const image = allImages[pageIndex];

                    // Create a promise for each page
                    const p = (async () => {
                        try {
                            const questions = await analyzeQuestionsFromImages([image], selectedSubject || undefined, CERTIFICATION_SUBJECTS[certification]);
                            return { pageIndex, questions };
                        } catch (err) {
                            console.error(`Error processing page ${pageIndex}:`, err);
                            return { pageIndex, questions: [] as QuestionModel[] };
                        }
                    })();
                    batchPromises.push(p);
                }

                setStatusMessage(`AI 분석 중... (페이지 ${i + 1}~${Math.min(i + CONCURRENT_LIMIT, allImages.length)} / ${allImages.length})`);

                const results = await Promise.all(batchPromises);

                // Collect results and update mapping
                for (const result of results) {
                    const startIndex = allQuestions.length;
                    allQuestions.push(...result.questions);

                    // Map these new questions to their page index and diagram bounds
                    result.questions.forEach((q: any, idx) => {
                        pageMap.set(startIndex + idx, result.pageIndex);

                        // Store diagram bounds if present
                        if (q.diagramBounds) {
                            diagramMap.set(startIndex + idx, {
                                pageIndex: result.pageIndex,
                                bounds: q.diagramBounds
                            });
                            console.log(`Diagram detected for question ${startIndex + idx}:`, q.diagramBounds);
                        }
                    });
                }
            }

            // Apply detected year to all questions if found
            if (detectedYear) {
                allQuestions.forEach(q => {
                    q.year = detectedYear;
                });
            }

            setQuestionPageMap(pageMap);
            setQuestionDiagramMap(diagramMap);
            setExtractedQuestions(allQuestions);
            setStatusMessage(`분석 완료! ${allQuestions.length}개의 문제를 찾았습니다.${detectedYear ? ` (${detectedYear}년)` : ''} `);

        } catch (err: any) {
            console.error(err);
            setError(err.message || '처리 중 오류가 발생했습니다.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDownload = () => {
        const data = {
            extractedQuestions,
            generatedVariants,
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
                                const croppedDiagram = await cropDiagram(pageImage, diagramInfo.bounds);

                                // Upload cropped diagram
                                const filename = generateUniqueFilename('jpg');
                                const diagramUrl = await uploadDiagramImage(croppedDiagram, filename);
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

                try {
                    // Save original
                    const savedOriginal = await quizApi.saveQuestion(questionToSave);
                    successCount++;

                    // Generate variants if enabled
                    if (generateVariants) {
                        setStatusMessage(`문제 저장 및 변형 생성 중... (${i + 1}/${extractedQuestions.length})`);
                        const variants = await generateFiveVariants(savedOriginal);
                        for (const variant of variants) {
                            await quizApi.saveQuestion(variant);
                        }
                        setGeneratedVariants(prev => [...prev, ...variants]);
                    } else {
                        setStatusMessage(`문제 저장 중... (${i + 1}/${extractedQuestions.length})`);
                    }

                } catch (err) {
                    console.error(`Error saving question ${i}:`, err);
                    // Continue saving others
                }
            }

            setIsSaveCompleted(true);
            setStatusMessage(`✅ 저장 완료! 총 ${successCount}개의 문제가 저장되었습니다.`);
            if (onQuestionsUpdated) {
                onQuestionsUpdated();
            }
        } catch (err) {
            console.error(err);
            setError('일괄 처리 중 오류가 발생했습니다.');
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
                    {(extractedQuestions.length > 0 || generatedVariants.length > 0) && (
                        <button
                            onClick={handleDownload}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium"
                        >
                            결과 다운로드 (JSON)
                        </button>
                    )}
                    <button onClick={() => navigate('dashboard')} className="text-blue-500 hover:underline">
                        나가기
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
                {/* Exam Standard Upload Section */}
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

                {/* Drag and Drop Zone */}
                <div className="mb-4">
                    <span className="text-slate-700 dark:text-slate-300 font-medium mb-2 block">3. 기출문제 파일 업로드 (PDF 또는 이미지)</span>

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
                {selectedFiles.length > 0 && (
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
                )}

                {error && (
                    <div className="p-3 mb-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md text-sm whitespace-pre-line">
                        {error}
                    </div>
                )}

                <button
                    onClick={handleProcessStart}
                    disabled={selectedFiles.length === 0 || isProcessing}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {isProcessing ? statusMessage : `파일 분석 및 문제 추출 시작(${selectedFiles.length}개 파일)`}
                </button>
            </div>



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
